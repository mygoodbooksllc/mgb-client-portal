---
title: How do I add staff and manage their access?
section: Admin
audience: admin
keywords: [staff access, add staff, bulk import, role, admin, bookkeeper, deactivate, assign clients, manage, temporary admin access, grant, revoke, view as, email invite, client roster]
sort: 510
---
**Staff Access** (staff menu → Staff Access) controls who can sign in and with what role.

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

It unlocks **Team**, **Task templates**, **Staff Access**, **Client Roster**, **Developer Tools** and **Usage Stats**. Staff Access, Client Roster and Developer Tools open **read-only**. **Audit log** and **Emails** stay real-admin-only. Offboarding also ends it.

### View as

Click **View as** on an active bookkeeper's row to see exactly what they see, including their assigned clients and reminders. Click **Exit "View as"** to return. Every View as is recorded in the Audit log.

### Troubleshooting

- **"Staff email must be a mygoodbooks.org address…"** Google sign-in only accepts the firm domain.
- **"…signed in with Google but isn't on the MyGoodBooks staff list."** They aren't on the roster, or they're deactivated.
