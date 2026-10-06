---
title: How do I add staff and manage their access?
section: Admin
audience: admin
keywords: [staff access, team, members, members tab, entity type, nonprofit, for-profit, add staff, bulk import, role, admin, bookkeeper, deactivate, assign clients, manage, temporary admin access, grant, revoke, view as, email invite, client roster, account manager, payroll, payroll add-on, payroll tab, portal logins, invite, resend invite]
sort: 510
---
The **Members** tab of **Team** (sidebar → **Team** → **Members**) controls who can sign in and with what role. It used to be a separate page called **Staff Access**; old Staff Access links (`#/staff-access`) open this tab.

> This page writes directly to the real staff table. Nothing here is sample data.

### Add a staff member

1. In **Add staff**, enter their **@mygoodbooks.org** email, **Full name** and role (**bookkeeper** or **admin**).
2. Click **+ Add**.
3. Tell them to sign in with Google using that exact address. Add them here first, or Google will let them in and the app will turn them away.

To add several people at once, paste `email, name, role` rows into **Bulk import**, check the preview for errors and click **Import N staff**.

The app doesn't send invitations. **Email invite** opens a pre-filled draft in Gmail (click **or mail app** to use your mail app instead) for you to send yourself.

### The Staff roster

Each row has Name, Email, Role, Active, Clients and Temp admin access. You can't change your own row.

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

It unlocks **Team** (both tabs; the Members tab opens **read-only**) in the sidebar, and **Task templates**, **Client roster**, **Usage stats** and **Developer tools** under **Settings → Firm settings**. Client roster and Developer tools open **read-only**. **Audit log**, **Emails**, **Feedback** and the QuickBooks API usage card stay real-admin-only. Offboarding also ends it.

### View as

Click **View as** on an active bookkeeper's row to see exactly what they see, including their assigned clients and reminders. Click **Exit "View as"** to return. Every View as is recorded in the Audit log.

### Client roster: organization type

On **Client roster** (**Settings → Firm settings → Client roster**), the add form and each row's edit mode have a **Nonprofit** / **For-profit** choice under the organization type. New clients default to **Nonprofit**. Staff can also change it on the client's Onboarding card. See [How does client onboarding work?](#/help/onboarding).

### Client roster: account manager

Each row on **Client roster** has an **Account manager** column, and the add form and edit mode have an **Account manager** picker (active staff). New clients start with Jesse. The account manager gets the email when that client sends a message. You can also change it on the client's Overview under **Key dates and coverage**.

### Client roster: payroll add-on

Tick **Payroll add-on** in the add form (or a row's edit mode) for clients who use MyGoodBooks payroll. Only those clients get a **Payroll** tab in their portal. Leave it unticked and the tab doesn't show at all, for the client or for staff viewing that client. Ticking it later adds the tab straight away.

Clients without it can ask for it from the **Payroll** card under **Add-ons** on the **Plan** tab of their Settings (**Add Payroll**). The request shows on your Home page in **Needs you** as an **Upgrade**. Once they've signed up, tick the box here; the card then says *Payroll is on for {client}*.

### Client roster: portal logins

The contacts on **Client roster** can sign in to the client portal (by emailed link or code). **+ Add** sends the person an invite. **Bulk import** doesn't, so click **Invite / Resend invite** on each imported row.

### Troubleshooting

- **"Staff email must be a mygoodbooks.org address…"** Google sign-in only accepts the firm domain.
- **"…signed in with Google but isn't on the MyGoodBooks staff list."** They aren't on the roster, or they're deactivated.
