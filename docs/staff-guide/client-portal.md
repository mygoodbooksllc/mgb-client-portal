---
title: What does the client portal look like?
section: Working with a client
audience: staff
keywords: [client portal, client view, client sidebar, client navigation, home, needs you, finances, reports, board packet, presentation view, report builder, downloads, requests, bottom bar, phone, what the client sees, places, top bar, help menu, question mark menu, ? menu, take the tour, contact support, what we need from you, answer a request, /login?next]
sort: 261
---
Clients get five places in their left rail, with **Settings** at the bottom. Use **Client view › View as client…** on any client to see exactly what they see.

- **Home** lists what needs them first (documents you've asked for, an unread message from you, a budget waiting for approval), beside an organization card with their **Milestone**, their plan and **See plans**. Their dashboard cards follow, and **Customize dashboard** still picks and orders them.
- **Messages** has two tabs: **Conversation** (the thread with you) and **Requests**, headed **What we need from you**: every question, document or approval you've asked for (from **Ask client** or the Documents tab), with due dates and what's overdue. They answer right there: type a reply, attach a file and **Send**, or **Upload** for a document request. **Show answered** lists what they've already sent. When you preview as a client the answer boxes are read-only. `#/client/<id>/needs` opens it, and the portal link in a request email signs them in and lands on the request.
- **Finances** holds **Budget**, **Bank accounts**, **Cash flow**, **Giving & funds** and **Payroll** (when they have the add-on) as one row of tabs. It reopens the tab they used last. The tab order follows **Manage access › Organization tabs**, where you can drag ⠿ to reorder.
- **Reports** has **Downloads** (their statement PDFs: Profit & Loss, Balance Sheet, Budget vs. Actual and Contribution Statement, plus Payroll, year to date, with the payroll add-on) and **Board packet**. Board packet is part of Pro; Basic clients see one card explaining it, with **See plans**. Someone at a Pro organization whose Pro pages are turned off (or whose access is limited to certain categories) sees a short note to ask their bookkeeper instead, with no upgrade button.
- **Documents** is where they upload what you ask for. On Basic they can also drop files on Home and say where they go.

Basic and Pro clients both land on **Home**. On Basic, Home has **Needs you** and the organization card, then **Home at a glance**: a **Choose files** box (and the whole page takes dropped files; see below), **Latest from your bookkeeper** with **Reply**, **Latest statements** (opens Reports), **Your files** (the newest Documents, opens Documents) and one slim row saying what Pro adds, with **See plans** and **Take the Pro tour**. There's no financial snapshot on Basic. Turning a tab off under **Manage access › Organization tabs** hides it everywhere; a place with nothing left in it disappears from the rail.

### Drop files on a Basic client's Home

A Basic client can drag files anywhere onto Home. The page shows **Drop to upload**; on release a box asks **Where should this go?** with big buttons: **Bank statement**, **Credit card statement**, **Receipts**, **Invoices and bills**, **Tax documents** or **Something else**. **Choose files** does the same for people who don't drag, and it works on a phone. It is the same upload as the Documents page, so the file goes to Google Drive under `<Client>/<Year>/<Document type>` (the button picks the type: Bank statements, Credit card statements, Receipts, Invoices, Tax forms, Other) and shows in **Documents**. Like any client upload, it also shows as a **New file** on your Today list (**Documents** chip) and in the Desk's Inbox (**Files** filter) until someone ticks **Mark checked**. Same limits as Documents: PDF, PNG, JPEG, HEIC, CSV, Excel, Word and text files, up to 25 MB each. Files that don't qualify are listed and skipped. If a file fails, the box stays open with just the failures so the client can try again or pick another place; the ones that went through aren't sent twice. Staff who preview a Basic client see the box but it's off: only the client's own login uploads.

### Board packet is the one report builder

There's no separate Report Builder or Custom Report any more. On Pro, **Reports › Board packet** is the one place a client builds reports, and **Downloads** keeps the canned statement PDFs. The Quick Download grid and Custom Report that used to sit above the packet are gone from the client's Board packet tab.

- **Board packet** (the tab) holds the board reports: pick the reports, add a cover page and a treasurer's note, and download one PDF with a table of contents. It also has saved templates, comparison columns, the Statement of Functional Expenses, giving reports, a plain-language summary, read-only share links and the church's logo and colors.
- **Presentation view** is a button on the packet. It shows the packet full screen for a board meeting on a projector: large type, the organization's name and period at the top, then the sections the client ticked. **Esc** or **Exit presentation** closes it. It needs at least one section ticked.
- Staff see one page instead of two tabs. For a Pro client, **Reports** shows the Downloads grid first, then **Board reports** below it, so you can check either without switching.
- The Reports header on Pro reads "Download statements and build your board packet".

### The ? menu

Next to the bell in the client's top bar is a **?**. It's for the client, and it's separate from the **?** staff have in their own top bar. Its items, in order:

1. **Take the tour**: runs the guided tour again (see [How does the client guided tour work?](#/help/client-tour)).
2. **Take the Pro tour**: only for Basic clients. It runs the Pro walkthrough (see [How does the Pro tour work?](#/help/pro-tour)).
3. **Message your bookkeeper**: opens Messages. Only shown to people who have the Messages tab.
4. **What we need from you**: opens **Messages › Requests**. Same rule.
5. **Help and settings**: opens **Settings › Help**.
6. **Contact support**: opens an email to admin@mygoodbooks.org.

When you use **Preview as** or **View as client**, the first two read **Preview the tour** and **Preview the Pro tour**, and nothing is saved or counted. Arrow keys move through the items, **Esc** closes the menu, and on a phone the items are larger so they're easy to tap. Admins see how often it's used under **Settings › Firm settings › Usage stats › Actions** as **Client ? menu clicks** (real clients only, not previews).

On a phone the QuickBooks sync pill in the top bar is shortened to "Synced 5 minutes ago" so the bell, **?** and search all fit on one row. The full wording ("Every hour · synced 5 minutes ago") shows on larger screens. Before QuickBooks is connected, the grey **Setting up — connecting QuickBooks** pill likewise says just **Setting up** on a phone.

### On a phone

A bar along the bottom has **Home**, **Messages**, **Finances**, **Reports** and **More**, which holds **Documents** and **Settings**. A red dot marks an unread message or an open document request.

### Links

Tabs are in the address, so `#/client/<id>/finances` opens their last Finances tab and `#/client/<id>/reports/packet` opens Board packet. Old links such as `#/client/<id>/bank` still work.
