---
title: How do I add staff and manage their access?
section: Admin
audience: admin
keywords: [staff access, team, members, members tab, entity type, nonprofit, for-profit, add staff, bulk import, role, admin, bookkeeper, deactivate, assign clients, manage, temporary admin access, grant, revoke, view as, client roster, account manager, payroll, payroll add-on, payroll tab, portal logins, invite, resend invite, fix sign-in, can't sign in, sign-in account, signup disabled, signups not allowed, new sign-ups off]
sort: 510
---
The **Members** tab of **Team** (the left rail → **Team** → **Members**, or `#/team/members`) controls who can sign in and with what role.

> This page writes directly to the real staff table. Nothing here is sample data.

### Add a staff member

1. In **Add staff**, enter their **@mygoodbooks.org** email, **Full name** and role (**bookkeeper** or **admin**).
2. Click **+ Add**. The app also sets up their sign-in account, so Google will let them in.
3. Tell them to sign in with Google using that exact address. Add them here first, or Google will turn them away.

Their first sign-in must be with Google. Until they've done that once, the emailed sign-in code in the installed app won't let them in.

To add several people at once, paste `email, name, role` rows into **Bulk import**, check the preview for errors and click **Import N staff**. Everyone imported gets a sign-in account too. Ticking **Active** again for someone who was deactivated does the same.

If you see **"Added …, but sign-in setup failed — use Fix sign-in"**, the person is on the list but can't sign in yet. Use **Fix sign-in** (below). If it says the address is **already a client portal login**, Fix sign-in can't help: that address belongs to a client, so use a different one for the staff member.

### Fix sign-in

New sign-ups are switched off for the portal on purpose, so nobody can make their own account. That means being on the staff list isn't enough: each person also needs a sign-in account, which the app makes when you add them here.

If someone active has no sign-in account (they were added another way, or setup failed), a **Can't sign in yet** card shows at the top of this page, and their row has a red **Can't sign in** tag. Click **Fix sign-in** and they can sign in with Google straight away. Only real admins see the card; it never makes accounts for clients or deactivated staff.

Each fix shows in **Developer tools → Recent activity** as "set up Google sign-in for …". There's a limit of about 60 new accounts per admin per hour (200 for everyone together); if you hit it, wait a bit and click **Fix sign-in** again. It fixes up to 50 people per click; if more are waiting, the message says to run it again for the rest.

Why there's no automatic fix in the database: sign-in accounts can only be made safely by Supabase's own sign-in service, not by a database rule. So the page checks for anyone missing one and gives you the button instead.

The app doesn't send invitations, and there's no invite button. Once someone is on the roster and active, they just sign in with their Google account at the staff sign-in page. Tell them they're set up.

### The Staff roster

The roster is two cards: **Admins** and **Bookkeepers**, each with a headcount, people A to Z. Deactivated people stay in their role's card, dimmed, at the bottom. A bookkeeper with temporary admin access stays in **Bookkeepers** with a small **Temp admin** tag. Each row has Name, Photo, Email, Role, Active, Clients and Temp admin access. The **Photo** column shows each person's profile photo and whether it still needs an edit; click it to download, replace or restore it. See [How do I manage staff profile photos?](#/help/staff-photos). You can't change your own row. Change someone's **Role** and they move to the other card.

The owner also sees an **MGB (internal)** column on admin rows: untick it to stop that admin opening MyGoodBooks' own books. It's on for every admin by default and nobody else sees the column. See [What is MGB (internal), and who can open it?](#/help/mgb-internal).

- **Role**: switch between bookkeeper and admin.
- **Active**: untick to deactivate someone (they can no longer sign in). To move their work to someone else first, use **Offboard**. See [How do I offboard a staff member?](#/help/offboarding).
- **×** removes the person. They lose portal access immediately.

### Assign clients to a bookkeeper

Click **Manage** in the Clients column. Tick the clients they should see and click **Done**. Unticked clients don't appear in their switcher at all. Admins see all clients ("All (admin)").

The workload hint next to it shows how busy they are (**Has room** / **Overloaded**). See [How do I check team capacity?](#/help/capacity).

### Temporary admin access

Give a bookkeeper short-term access to the admin pages, for example while you're away.

1. On their row, pick **1 hour**, **1 day** or **1 week** in **Temp admin access**.
2. Click **Grant**.

The cell then shows **Until {date, time}** with a **Revoke** button. It ends on its own at that time.

It unlocks the admin tabs of **Team** (the Members tab opens **read-only**), and **Task templates**, **Client roster**, **Usage stats** and **Developer tools** under **Settings → Firm settings**. Task templates (Slate › Recurring), Client roster and Developer tools open **read-only**. **Audit log**, **Emails**, **Feedback** and the QuickBooks API usage card stay real-admin-only. Offboarding also ends it.

### View as

Click **View as** on an active bookkeeper's row to see exactly what they see, including their assigned clients and reminders. Click **Exit "View as"** to return. Every View as is recorded in the Audit log.

### Client roster: organization type

On **Client roster** (**Settings → Firm settings → Client roster**), the add form and each row's edit mode have a **Nonprofit** / **For-profit** choice under the organization type. New clients default to **Nonprofit**. Staff can also change it on the client's Onboarding card. See [How does client onboarding work?](#/help/onboarding).

### Client roster: account manager

Each row on **Client roster** has an **Account manager** column, and the add form and edit mode have an **Account manager** picker (active staff). New clients start with Jesse. The account manager gets the email when that client sends a message. You can also change it on the client's Overview under **Key dates and coverage**.

### Client roster: payroll add-on

Tick **Payroll add-on** in the add form (or a row's edit mode) for clients who use MyGoodBooks payroll. Only those clients get a **Payroll** tab in their portal. Leave it unticked and the tab doesn't show at all, for the client or for staff viewing that client. Ticking it later adds the tab straight away.

Clients without it can ask for it from the **Payroll** card under **Add-ons** on the **Plan** tab of their Settings (**Add Payroll**). The request shows on Today in **Needs you** as an upgrade request. Once they've signed up, tick the box here; the card then says *Payroll is on for {client}*.

### Client roster: portal logins

The contacts on **Client roster** can sign in to the client portal (by emailed link or code). **+ Add** sends the person an invite. **Bulk import** doesn't, so click **Invite / Resend invite** on each imported row.

### Troubleshooting

- **"Staff email must be a mygoodbooks.org address…"** Google sign-in only accepts the firm domain.
- **"…signed in with Google but isn't on the MyGoodBooks staff list."** They aren't on the roster, or they're deactivated.
- **Google says sign-ups are not allowed (or "signup disabled") for a new staff member.** They're on the list but have no sign-in account. Click **Fix sign-in** on the **Can't sign in yet** card, then have them try again.
