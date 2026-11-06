# Client portal demo review (2026-11-05)

Goal: the owner screen-shares the client side of the portal with a non-technical pastor over Google Meet. Judged as a desktop screen share (1280x720 and 1440x900, zoom 100-125%, dark and light, phone as a secondary check).

Method: live walkthrough of "Pro Test Client" (`grace-community`) through staff View as, a gates and data-safety audit, a three-way code and wording audit of `main` at 963a63e, and an Opus verify pass on the main claims (two claims were corrected by it, noted below). Presenter script: `docs/client-demo-presenter-guide.md`.

No client-facing code was changed. Every fix below is awaiting owner approval. Size: **XS** minutes, **S** under an hour, **M** a few hours, **L** a day or more. "Data" means no code change.

## Recommended demo client

**Pro Test Client (`grace-community`), viewed as "Pastor John Whitfield".** Pro plan plus Payroll add-on, church-shaped QuickBooks sandbox data, hourly sync, no real client names. Do not use "Basic Test Client" (it shows a "Prototype · Sample Data" pill and sample text) or any real client.

Important: the demo runs through staff View as, so some sample wording shows that a real signed-in client would never see (F-02). Real clients do not see it.

Clean-up before the call (all data, no code): rename the client (F-06), delete the sample request and file (F-01), seed one real message thread (F-02), remove the Payroll add-on for the day or skip Payroll (F-04), sync just before the call so the "numbers may be out of date" warning stays off (F-15), and demo mid-month or later so Budget has data (F-03).

## What is on today versus hidden

| Feature | Client state today |
|---|---|
| Home, Needs you, org card, snapshot | On |
| Messages (Conversation, Requests) | On |
| Finances: Bank accounts, Cash flow, Giving & funds | On for Pro (Basic sees a locked card) |
| Finances: Budget | On for Pro (misleading default, F-03) |
| Finances: Payroll | Only with the add-on; sample Gusto data (F-04) |
| Reports: Downloads, Board packet | On for Pro |
| Documents + client page drop | On (switch on for all clients since 2026-10-31; re-check in Dev Tools) |
| Org profile prompt | On since 2026-10-25 for real client logins; opens by itself after the tour (F-15) |
| Guided tour, "?" menu | On (13 steps, F-10) |
| Agreements (`agreements_client_enabled` unset), anniversary gifts, Slate/Desk, review board, installable app, staff tours/tips | Off or staff-only; checked: none mount for clients |

Never flip a switch for the demo. Live switch values were not re-read from the database in this pass.

## Fix before the demo

### F-01 Documents shows leaked test data · XS (data)
**Status: FIXED 2026-11-05 (data: sample request cancelled, Bluevine file trashed, grace-community only)**

- **Page:** Documents.
- **Wrong:** a request "Signed engagement letter (sample) / Sample request for testing" and a file "Bluevine Bank Account (2).pdf". A real bank name on screen looks like another client's file.
- **Steps:** View as Pastor John Whitfield > Documents.
- **Fix:** delete both rows (and the Drive file); add 3-4 church-looking documents.

### F-02 Messages: sample banner and canned August thread (View as only) · XS data / S code
**Status: FIXED 2026-11-05 (data: 5 seeded messages, ids de300000-0000-4000-8000-00000000000{1..5}; delete them to undo)**

- **Page:** Messages > Conversation.
- **Wrong:** banner "This is a sample conversation — sending a message here doesn't notify anyone yet." (`app.jsx:25115`) over canned messages dated Aug 20/21 quoting a $142,300 Building Fund balance that contradicts Giving & funds ($61,246) (`data.js:424-425`).
- **Verified correction:** a real signed-in client always gets the live thread (`app.jsx:30656-30659`), so real clients never see this. It appears because staff View as is not a live client session.
- **Fix:** seed one short real thread for the demo client (data). Or avoid Messages' Conversation tab and show Requests only.
- **Same cause:** Basic Home's "The client's latest message from you shows here." (`BasicHome.jsx:428`), only relevant if Basic is shown.

### F-03 Budget default view looks broken · M
- **Page:** Finances > Budget.
- **Wrong:** with no budget, the Year-End Forecast tab prints "$0 under budget" (`ProBudget.jsx:629-632`); every category spends $0 early in a month; a proposed-vs-current percent (such as "+956.3%") inflates whenever the current total is tiny or draft lines are for categories not in the current budget (`ProBudget.jsx:977-983`). The what-if field is prefilled with "part-time admin" and looks like sample data (`:695, :767`); "FY" is always this year + 1 (`:1323`).
- **Fix:** hide the percent when the base is under a threshold; say "No budget yet" instead of "$0 under budget"; blank the prefilled what-if. Workaround: skip Budget.
- **Note:** an earlier pass said "On Track" shows with no budget; verification found it only appears on budget rows.

### F-04 Payroll shows sample data and stale dates · XS (data)
- **Page:** Finances > Payroll.
- **Wrong:** "Sample Gusto data, not connected yet", September dates, Q3 deposits still "Upcoming".
- **Fix:** remove the add-on from the demo client for the day, or skip.

### F-05 Board packet says giving and funds are not connected · S (quick) / M (real)
**Status: FIXED a4afb09 (Board packet Giving reads givingQbo, same as Giving & funds; test added)**

- **Page:** Reports > Board packet (and the Plans page, `app.jsx:12892`).
- **Wrong:** "Giving isn't connected yet, so there's no giving to report." (`ProReports.jsx:497-500`). The packet reads `client.contributions`, which is always `[]` for QuickBooks clients (`mapQboToClient.js:714`), while the Giving & funds tab shows real giving. (The funds note at `:403-407` is correct: it only shows when there are no funds.)
- **Fix:** quick: "Giving isn't included in packets yet." Real: feed the packet from the QuickBooks giving data.

### F-06 Display name is "Pro Test Client" · XS (data)
- Shown on Home org card, Settings, tab title. Rename to a believable church name (owner decision).

### F-07 Board packet: "vs. same month last year" ticked but cannot work · XS
- Board packet and finance-committee presets check it by default (`ProReports.jsx:63, 68, 598`); with under 13 months it is greyed with a reason but stays ticked (`:290-293, 2391-2398`).
- **Fix:** untick when unavailable.

### F-08 Light theme: Home heading low contrast · XS
- **Verified correction:** not invisible. The word "Overview" in the Home heading is hard-coded gold `#c7ae86` (`DailyClose.css:176-184`), weak on the light `#f9faf6` surface. Other heading text uses the dark token.
- **Fix:** darker gold in light theme. Workaround: present in Dark.

### F-09 Jargon and an unexplained "Alert" pill on Home · S
- "Alert" pill on Cash has no explanation and a tiny click target (`DailyClose.tsx:1469`).
- Words: "Anomalies & Flags" (`:1942`), "Accounts receivable/payable" (`:1517, :1539`), "{pct} margin · target 25%" (hard-coded, `fromClient.js:532`), Form 990 "(A) Total / (B) Program services…" columns on by default (`ProReports.jsx:62, 1527-1530`).
- **Fix:** "Needs a look", "Money owed to you", "Bills to pay"; hide margin target; label the pill "Set low-cash alert".

### F-10 Tour does not match the screens · M
- 13 steps, "about two minutes". Step 2 says "Customize dashboard" but the button reads "Customize overview"; the tour calls a tab "Giving" (`Tour.jsx:340`); one step describes Settings "Your organization" not in this contact's list; the Basic Home step mentions dropping files without checking the drop switch (`Tour.jsx:652-653`).
- **Fix:** align the text and targets; trim to the core steps; follow `mgb-ui-upkeep` (guide, tips, README).

### F-11 Settings › Plan shows a "prototype" flask banner to every client · XS
**Status: FIXED 2510f96 (flask banner removed)**

- `app.jsx:12987`: `MockBanner "Upgrading isn't automatic yet — your request goes to your bookkeeper…"` passes no `client`, so it shows to everyone, real clients included (confirmed).
- **Fix:** plain subtitle line.

### F-12 Banners that name a SQL file or say changes are not saved · S
- `ProReports.jsx:18, 2207` ("Saving needs supabase/pro-budget-reports.sql."), `ProBudget.jsx:22, 24` (same, and "Changes here stay on this page for now").
- Appear when tables or connection are missing. **Fix:** "Saving isn't available right now."; show file names to staff only. Not seen in the live sweep; low chance on the demo client.

### F-13 Documents: staff voice and a risky × · S
**Status: FIXED a4afb09 (folder delete and rename in a confirmed ⋯ menu, client wording)**

- Delete-folder confirm: "…changes the folder for everyone on this client's Documents page." and new-folder modal "Everyone on this client's Documents page sees the new folder." (`app.jsx:24002-24019, 24522-24524`).
- Clients can create and delete shared folders (database allows it: `document-folders.sql:54-56`). The delete × is a 16px span inside the folder chip, an easy mis-click on a shared screen (`styles.css:2638-2647`).
- **Fix:** "everyone at your organization"; make the × a real button 24px or larger, or put delete in a menu. Do not click folder chips' × during the demo.

### F-14 Security & privacy tab: claims to confirm with the owner before anyone reads them aloud · S (wording)
**Status: FIXED a4afb09 (Security & privacy claims made true; no vendor names)**

Text a client reads (`Settings.jsx`): "Only people you and MyGoodBooks have set up. No one else." (:2320); "The connection key is encrypted." (:2350); "With Supabase, in the United States (Ohio). Everything is encrypted when stored and when sent… hosted by Vercel… sent through Resend." (:2354); "Account details and messages are backed up every day." (:2357); working files "never shared outside MyGoodBooks" (:2337); "no portal password to change or steal." (:2201).
- Problems: "No one else" is contradicted by staff with access; vendor names mean nothing to a pastor; a code comment (`:2292`) notes daily backups do not include uploaded files, so "backed up" is true only for account details and messages.
- **Fix:** reword; keep to what is true (see presenter guide).

### F-15 Two pop-ups open by themselves on a first visit · XS
- The tour starts ~600 ms after sign-in (`Tour.jsx:2556-2581`); when it ends the "Finish your organization profile" modal opens (`OP_ClientPrompt.jsx:20-38`; live since 2026-10-25, "Later" lasts only for the session). A "Get set up" checklist also shows.
- View as does not trigger these; a real first login does. **Fix:** sign in once as the demo user beforehand and finish/skip everything.
- Also: if the last sync is over ~4 hours old, Home warns "numbers may be out of date" (`daily-close/fromClient.js:98-115`). Sync just before.

### F-16 Raw dates and a "$0 overdue" warning on Home · XS
- Anomalies show ISO dates such as "due 2026-10-02" (`fromClient.js:316, 331, 344`); an amber "$0 overdue" chip appears when nothing is overdue (`DailyClose.tsx:1519-1522`).
- **Fix:** format dates; show "Nothing overdue" in a good tone when 0.

### F-17 Sign-in screen and Organization settings wording · S
- "Email me a sign-in link" has no sending state; a second click gives a red "Please wait N seconds…" (`ClientAuthGate.jsx:171-205, 348`). Fix: disable and show "Sending…".
- Organization settings hint "The Google Workspace email they'll sign in with." (`Settings.jsx:1997`); clients sign in by emailed link. Fix: "The email they'll use to sign in."
- Do not click "Sign in" on the sign-in screen during the demo.

## Nice to have

- **N-01** Transaction questions use staff voice for clients: "Client thinks it's…", "Asked by {email}", "Open question from the client" (`TxnQuestions.jsx:401-413, 666-674`). Only if the demo client has open questions. S.
- **N-02** Raw error text shown to clients: `Settings.jsx:1884, 1980`, `ClientNeeds.jsx:66`, `ClientPageDrop.jsx:561`, `ProBudget.jsx:1157, 1252, 1271`, `ProReports.jsx:2029`, `QboGiving.jsx:284, 320`, `BasicHome.jsx:334`. Use fixed friendly text. S.
- **N-03** Requests page shows "Couldn't load requests." under "Nothing is waiting on you right now." when loading fails (`ClientNeeds.jsx:285-297`). XS.
- **N-04** Name consistency: "Giving & funds" vs "Giving & Funds" vs "Fund Balances"; "Board Packet" vs "Board packet"; Title Case KPI labels; Requests called three names (tab, "What we need from you", "Requests from your bookkeeper"); Plans page product names seen nowhere else. XS.
- **N-05** Plurals: "1 open invoices, 1 customers", "across 1 invoices", "1 days overdue" (`DailyClose.tsx:1524, 1678`, `fromClient.js:329`). XS.
- **N-06** Tiny text on a shared screen: 10 to 11.5px in `DailyClose.css`, `pro-budget.css:443`, `settings.css:155`, `tour.css:60`, `styles.css:2633`, `client-page-drop.css:65,70`; footer text contrast about 3.1:1. Raise to 12px and darken. S.
- **N-07** Notification toggles: the "off" track is nearly invisible (about 1.3:1, `settings.css:42`). XS.
- **N-08** Home footer says "data syncs from QuickBooks automatically" even when the chip says not connected (`DailyClose.tsx:2059`); Basic header pill reads "Synced monthly · synced 2d ago" (`app.jsx:1633-1637`). XS.
- **N-09** Settings: "Message your bookkeeper" and "Open Messages" shown even when the Messages tab is hidden for that person (`Settings.jsx:2265, 2342`); team card says "No one else yet." if its lookup fails. XS.
- **N-10** Raw QuickBooks types ("Journal Entry") in transaction tables; blank type cell in giving (`BankAccounts.jsx:1048`, `QboGiving.jsx:595`). XS.
- **N-11** Accessibility: "Attach a file" input has no visible focus ring (`client-needs.css:63-68`); client sign-in screen shows "MyGoodBooks staff? Sign in with Google" (harmless, open the call already signed in). XS.
- **N-12** Page drop: if on, dragging a file anywhere opens the drop dialog, and at 1280px the "+ Add a file" button is hidden (`client-page-drop.css:77-79`). Check the switch. XS.
- **N-13** First load takes several seconds ("Loading your portal…") because the app compiles in the browser. Pre-load before sharing. L to fix properly; skip.

## Leave

- Count-up animation makes numbers look wrong for a second; wait before narrating.
- View as's gold "Previewing as" bar is honest; fine on screen.
- Phone layout: no sideways scrolling on any client page; bottom bar with More works.
- Staff tours, tips and announcements never mount for clients. No lorem, TODO, UK spelling, or Desk/Slate/GL/RLS strings in client-reachable text.
- Do not click during the share: "Draft Reminder" (opens the mail app), "Contact support" (mailto), "Sign out on all devices" (no confirm), Upload, Send, Sync now.

## Staff-only or hidden features leaking to clients

- F-11 Plan banner (real clients see it). F-12 SQL-file banners (only on failure). N-01 staff voice in transaction questions. F-13 "this client's" wording. F-02 and Basic Home's staff line are View-as or Basic-sample only.
- The other prototype banners in `app.jsx` (lines 4877, 9322, 9568, 9903, 10176, 10837, 11078, 11197, 11408, 11477, 12732, 13246, 13664, 23922) pass `client` and hide themselves on QuickBooks clients or `test_only=false`. If the demo client were `test_only` and not on QuickBooks, every page would show them; Pro Test Client is on QuickBooks so they stay hidden.
