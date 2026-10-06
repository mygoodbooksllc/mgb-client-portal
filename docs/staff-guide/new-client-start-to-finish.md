---
title: How do I set up a new client from start to finish?
section: Working with a client
audience: staff
keywords: [new client, add client, add organization, set up client, setup, client roster, assign bookkeeper, account manager, plan, basic, pro, payroll add-on, invite, portal login, add a contact, client contacts, invite client, resend invite, connect quickbooks, first sync, onboarding, folders, tour, first sign in, start to finish, checklist]
sort: 205
---
This is the whole path for a new client, in order. Each step links to the full article if you need more detail.

Adding the client and their logins is done on **Client roster**, which only admins can change. If you're not an admin, ask one to do steps 1 to 3. (Staff with temporary admin access can open Client roster, but it's read-only for them.)

### 1. Add the client

1. Click your initials at the top right, then **Settings**, then **Firm settings**, then **Client roster**.
2. Find the **Client organizations** card. Under the table, fill in the add row:
   - **Organization name** (required).
   - **Org type** (required), for example *Church* or *Church Plant*. This is free text.
   - **Nonprofit** or **For-profit**. It starts on **Nonprofit**.
   - The plan. It starts on **Basic** (see step 3).
   - **Payroll add-on** checkbox. It starts unticked (see step 3).
   - The bookkeeper picker and **Bookkeeper role** (see step 2).
   - **Account manager**. It starts on Jesse.
3. Check the **ID** line under the row. The ID is made from the name (for example *Grace Community* becomes `grace-community`) and can't be changed later. If it says **already in use by another org**, change the name a little.
4. Click **Add organization**. You'll see *Added {name}.*

The new client shows up in the client picker straight away. Their five document folders are created at the same time (see step 6).

New clients are always normal clients. The test-only flag (which hides a client from non-admin staff and from emails) can't be set here.

### 2. Assign the bookkeeper

In the same add row, pick the bookkeeper from the staff list (it says **Not assigned** until you do). Under the picker you may see how many clients that person already has, with **Has room** or **Overloaded** when their hours are tracked. Add a **Bookkeeper role** if you like, for example *Senior Bookkeeper*.

Saving the bookkeeper also gives that person access to the client, so they can open it right away. The bookkeeper and account manager show on the client's Dashboard and in their **Settings** under **Who can see your books**.

To change either later, click **Edit** on the client's row, change it, then **Save**. See [How do I add staff and manage their access?](#/help/staff-management).

### 3. Choose the plan and payroll add-on

- **Plan**: **Basic** or **Pro**. Basic is free with 1 login included; each extra login is $20/mo. Pro is $100/mo plus $20/mo per login. Both are on top of the milestone fee. The plan decides which pages the client sees and how often QuickBooks syncs (Basic monthly, Pro every 15 minutes).
- **Payroll add-on**: tick it only if the client uses MyGoodBooks payroll. Only then do they get a **Payroll** tab.

You can change both later with **Edit** on the client's row. See [Where are a client's Settings, Plan, Manage access and Client details?](#/help/client-settings).

### 4. Add the client's portal logins

Each person at the client who should sign in needs their own row. Still on **Client roster**, use the **Add a contact** card:

1. Pick the client from the menu.
2. Type their email (for example *name@theirdomain.org*), **Full name** and **Role** (for example *Board Treasurer*). All three are required.
3. Click **+ Add**.

You'll see *Added {name} ({client}).* If the client is on Basic and already has a login, it says *…is on Basic, so this extra login is $20/mo.*

Adding the person also sends their invite email straight away. A second message tells you how it went:

- *Invite sent to {email}.* The invite is on its way.
- *{email} already has a sign-in account — they can sign in from the portal login page.* No email was sent. They just go to the login page (see [How does a client sign in, and what do I tell them if they can't?](#/help/client-sign-in-help)).
- *Couldn't invite {email}: …* The person is still on the list. Fix the problem and click **Invite / Resend invite** on their row. If it says the email *is already set up for a different organization*, that address belongs to another client. One email can only belong to one client.

The invite email contains a link that opens **app.mygoodbooks.org/login** and signs them in. After that first time, they sign in with their email and a one-time link or code.

Each person starts with **Full access**. To limit what they see, click **Edit access** next to their row in **Client contacts**, choose **Limited access**, pick what they can see, then **Save access**.

**Bulk import does not send invites.** If you add people with **Bulk import**, click **Invite / Resend invite** on each new row afterwards, or they won't be able to sign in.

Tip: if you can, connect QuickBooks and run the first sync (steps 5 and 6) before you add logins, so the client sees real numbers on their first visit.

### 5. Connect the client's QuickBooks

Staff start the connection. There is no Connect button on the client's side.

1. Open the client, click the **Settings** gear at the bottom of their sidebar, then **Client settings → Client details → Open**, then the **QuickBooks** tab.
2. Click **Connect QuickBooks**. Intuit opens in a new browser tab.
3. Sign in to Intuit with a QuickBooks login that can manage this client's company, and pick the company. If you don't have one, do this on a call with the client so they can sign in.
4. Approve the connection. The tab shows **QuickBooks connected** and *You can close this tab and go back to MyGoodBooks.*
5. Back in the portal, switch to another tab in the window and back to **QuickBooks** (or close and reopen it). It now says **Connected**.

The portal only reads from QuickBooks. It never changes anything in the client's books.

If the Intuit tab says **Connection cancelled**, **Link expired** or **Couldn't connect**, close it and click **Connect QuickBooks** (or **Try again**) again. See [How do I connect a client's QuickBooks and use Sync now?](#/help/quickbooks-connection).

### 6. First sync, Onboarding and folders

- **First sync**: a newly connected client syncs on its own within a few minutes, whatever their plan. To do it now, click **Sync now** on the same QuickBooks tab. You'll see *Synced {n} records from QuickBooks. Reload to see the new numbers.* Reload the page. Until the first sync, the client's pages have little or no data.
- **Onboarding**: the client's **Client overview** has an **Onboarding** checklist. With the default steps, **QuickBooks connected** ticks itself as soon as the connection is saved (reload if it hasn't yet), and **First close done** ticks itself when a month is marked done in the Close tracker. Tick the others (*Agreement signed*, *Bank feeds added*, *Documents received*) by hand as you finish them. Admins may have changed the default steps. See [How does client onboarding work?](#/help/onboarding).
- **Folders**: every new client already has five folders: **Bank statements**, **Financial statements**, **Tax**, **Receipts** and **Payroll**. See [How do I add, file, hide or delete a client's documents?](#/help/add-documents).

### 7. What the client sees the first time

1. They open the invite link (or sign in at **app.mygoodbooks.org/login**).
2. A short guided tour starts on its own. It only shows pages that are on their plan and in their access.
3. After the tour, a **Get set up** card asks them to add profile details, check notification emails, invite a teammate (full access only), upload a requested document and message their bookkeeper.

See [How does the client guided tour work?](#/help/client-tour). **Preview as** only lists sample people, so for a brand-new client it usually has nobody to pick. Use **Preview plan** to see the pages their plan shows. See [How do I see the portal the way a client sees it?](#/help/preview-as).

### Troubleshooting

- **Add organization stays greyed out.** Fill in both **Organization name** and **Org type**, and make sure the ID isn't already in use.
- **I can't find Client roster, or I can't type in it.** Only admins can change it. Ask an admin.
- **The bookkeeper can't open the new client.** Check the bookkeeper picker on the client's row (**Edit**). It must be a staff member, not **Not assigned**.
- **The client didn't get an invite.** Click **Invite / Resend invite** on their row and read the message. If it says they already have a sign-in account, no email is sent; they sign in from the login page instead. See [How does a client sign in, and what do I tell them if they can't?](#/help/client-sign-in-help).
- **"Couldn't add {email}: …"** That email is probably already on the list, maybe for another client. Search for it in **Client contacts**.
- **The QuickBooks connected step hasn't ticked.** Check the QuickBooks tab says **Connected**, then reload the page.
- **The client's pages are empty.** QuickBooks hasn't synced yet. Click **Sync now** on the QuickBooks tab, then reload.
