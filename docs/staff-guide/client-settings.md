---
title: Where are a client's Client setup (staff) and Settings (client)?
section: Working with a client
audience: staff
keywords: [organization tabs, hide a tab, hidden tabs, month rhythm, own rhythm, client rhythm, uses the firm rhythm, use the firm rhythm, client settings, client setup, settings, gear, milestone, help menu, question mark menu, manage access, client details, plan, plans, upgrade, change plan, organization, summary recipients, sign out, sign out all devices, security, privacy, data, who can see, encryption, delete my data, client notifications, client profile, pro tour, request access, theme, dark mode]
sort: 262
---
Staff and clients open different things from the gear. Staff have **Client setup**. Clients have **Settings**.

- **Staff:** the **Client setup** gear is at the right end of the client's tab row. It says **Client setup, new access request waiting** to a screen reader when someone is waiting, and shows a red dot.
- **Clients:** **Settings** is at the bottom of their sidebar, above **Collapse**, and under **More** in the bottom bar on a phone.

### What you see (staff): Client setup

Click **Client setup**. The page is called **Client setup**, and the browser tab reads *{client} · Client setup · MyGoodBooks*. You can send a teammate the address: `#/client/{id}/settings`, or `#/client/{id}/setup`. It adds `/client`, `/plan` or `/milestone` for the tab. It has these tabs:

- **Access and details** (staff only). Clients never see it.
  - **Manage access**: who at the client can sign in, what each person sees, and portal access requests. When there's a new request, the tab has a gold dot and the row says **New request**.
    - **Organization tabs** (admins): turn a tab off and nobody at the client sees it, on any device, whatever their own access. **Home** always stays. Other staff see the switches grayed out.
  - **Client details**: contacts, QuickBooks connection, notes, SOP, activity and the client's other details.
  - **Month rhythm**: the client's three monthly days (see **A client's own month rhythm** below).

  Each **Open** button opens a window. Links from other pages open the right window straight away, for example **Reconnect** on the Overview opens the QuickBooks part of Client details.
- **Plan**: the Basic and Pro comparison the client sees (Basic is free with 1 login included and extra logins at $20/mo each; Pro is $100/mo plus $20/mo per login; both are on top of the milestone fee), with the client's plan marked **Your plan**. **See plans** on the organization card on the client's Home opens it too.
- **Milestone**: only if you're not a real admin. Real admins have **Milestone** in the tab row instead. If a bookkeeper, an account manager or a temporary admin opens a Milestone link, they land here. This keeps the row simple. It isn't a security lock: what you can see is still set by your role and the client's access.

The **Client view** menu is separate. It's next to the gear and holds the client's own pages. See [How do I use the Clients page?](#/help/clients-page).

### A client's own month rhythm

Most clients follow the firm's month rhythm: Check in, Send reports and Follow up on the days set in **Settings › Firm settings › Month rhythm**. A client can have its own three days instead, for example when its board meets early in the month.

Open the client, then **Client setup › Access and details**. The **Month rhythm** row shows either "Uses the firm rhythm" with the firm days, or "Own rhythm" with the client's days.

- **Admins** select **Change**, pick the three days, and select **Save**. The days must be in order (Check in first, Follow up last) and between the 1st and the 28th.
- **Use the firm rhythm** removes the client's own days, so the client follows the firm days again.
- **Bookkeepers** can see which days apply but cannot change them.
- **Labels and weekends stay firm-wide.** The part names and what happens on a weekend or firm holiday always come from the firm setting.
- **What changes:** monthly tasks made from now on for that client use its days. Tasks that already exist keep their dates. The upcoming dates on **Slate › Recurring** for that client show the new days too.
- **Every change is recorded.** Clients never see this setting.

### What the client sees

- **Profile**: their name and phone. Their email is shown but can't be changed there.
- **Notifications**: emails when their bookkeeper sends a message, when month-end reports are ready, and the monthly summary. Document requests from us are always on and can't be turned off.
- **Organization** (people with full access only): the organization's name and mailing address, who gets the monthly summary (everyone, or people they pick), their team list, and **Ask us to add someone**, which sends us an access request (it shows up in Manage access).
- **Plan**: the plan comparison, where they can ask to change plans. On Basic it has a **Take the Pro tour** button, a two-minute walkthrough of what Pro adds (see [How does the Pro tour work?](#/help/pro-tour)).
- **Appearance**: Light, Dark or Match my computer.
- **Security & privacy**: **Sign out**, and **Sign out on all devices** for a shared or lost computer (they sign in with a one-time link or code we email them, so there's no password to change). Below that, plain-language answers for the client:
  - **Who can see your books**: their own access level, that MyGoodBooks sets up their team's logins, their bookkeeper and account manager by name, that admins see every client and other staff only when assigned or approved by the bookkeeper, and that every access change is recorded. It also tells them **staff-only working files** exist: files only MyGoodBooks staff can see, stored the same way and never shared outside MyGoodBooks. (Client files themselves are kept in MyGoodBooks' Google Drive; see [Where are client files stored?](#/help/google-drive-files).)
  - **How your data is stored and used**: QuickBooks is read-only, their sync schedule, the connection key is encrypted, and how to disconnect from Intuit. Data is stored with Supabase in the US (Ohio), encrypted, hosted by Vercel, emails via Resend, backed up daily. Never sold or used for ads.
  - **Keeping and deleting your data**: only staff remove documents, Trash never empties on its own, and how to ask for a copy or deletion (message the bookkeeper or email admin@mygoodbooks.org).
  - If a client asks for a copy of their data or to have it deleted, pass it to the owner. Don't promise anything the page doesn't say.
- **Help**: **Restart the tour** (they get the version that fits their plan and access; see "How does the client guided tour work?"), the **Pro tour** on Basic, Messages, the privacy policy and the terms of service. The tour, Pro tour and Messages rows are also in the **?** menu next to the bell in the top bar, along with **Help and settings** (which opens this tab) and **Contact support**; see [What does the client portal look like?](#/help/client-portal).

Clients' dark mode switch and **Sign out** button are in Settings, not the sidebar.

### When you use Preview as

While previewing as a client user you see their Settings tabs, read-only. Their personal settings belong to them, so nothing can be changed there, and the Organization tab is hidden. **Help** > **Preview the tour** (or **Preview the tour** in the top bar's **?** menu) shows you the version of the guided tour that person gets (it depends on their plan, access level and add-ons), without saving anything.

### Troubleshooting

- **I can't find Manage access or Client details.** Open the client, click **Client setup** at the right end of the tab row, then the **Access and details** tab.
- **I can't find the Milestone tab in the row.** Only real admins see it there. Everyone else finds it in **Client setup › Milestone**.
- **The client says they don't get the monthly summary.** On their **Organization** tab, someone with full access may have picked only certain people. Their **Notifications** tab says so too.
