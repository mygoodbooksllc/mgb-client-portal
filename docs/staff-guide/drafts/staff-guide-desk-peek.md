# Desk client summary: DRAFT guide text

> **PUBLISHED 2026-11-06** (label 2026-11-06c, launch of six previews). The live text is in `docs/staff-guide/` and `supabase/launch-2026-11-06.sql`; this draft is kept for reference.

Draft for the hidden Desk client summary preview (localStorage `mgb_peek_preview`, Feature flags label "Desk client summary (preview)" / firm switch `desk_peek_enabled`, owner-only). Publish at launch, when the owner flips `desk_peek_enabled`: add the section below to `docs/staff-guide/workbench.md` (slug `workbench`) and sync it, add the tip row to `docs/staff-guide/tips.md`, the What's new line to `whats-new.md`, and re-date the `desk-client-summary` notice in `components/tour/announcements.js`. Do not copy into the live guide before then.

One change ships live with this build and is already true for everyone: the left sidebar's **Pin this client** shows a star instead of a pushpin (the words stay "Pin"). Nothing in the guide named the pushpin, so no guide text changes for it.

## What's new (draft line)

- The Desk's Client tab starts with a short summary of the client, and **Keep on Desk** holds one client there while you open other pages. A **Customize** button in the Desk head turns Glance and Right now on or off and picks what shows while the Desk is closed.

## Client tab: the summary (workbench.md section)

Open your Desk, pick the **Client** tab and choose a client. Under the client's name is a short summary:

- **Who works on it.** The bookkeeper and the account manager. Your own name shows as **You**. No bookkeeper yet says **No bookkeeper assigned**.
- **First contact.** The client's first request contact (or, with none, the first portal user), with their email. **Copy** puts the email on your clipboard. **+2 more** means there are more; the full list is under **Contacts** lower in the Client tab. With no contacts it says **No contacts yet · Add**, which opens that Contacts list.
- **Drive folder.** Opens the client's main Google Drive folder in a new tab.
- **Pinned note.** A pinned **Status** or **Handoff** note on the client, so a heads-up is the first thing you see. If the note mentions fees, rates, payments or any amount, the summary says **See pinned note** instead of the words; open the note on the client's page to read it.
- **Last message.** The last message from the client and when it came in. Click it to open the chat. Staff-only notes never show here.
- **Next.** How many of your open tasks for this client there are and how many are late (for example **3 open · 1 late**). Click it to jump to them below.

The summary never shows money: no fees, rates, invoices, payroll or balances.

The arrow on the right folds the summary to one line (on a short screen it starts folded). Your choice is remembered in this browser. Each line loads on its own: if one can't load it says **Couldn't load** with a **Retry** button and the others still show.

**Who sees what.** You only see clients you can open (the same list as the client picker). For any other client the Desk loads nothing at all. The summary is not in the Desk while an admin uses **View as**, because the Desk itself is off then.

## Keep on Desk

Normally the Desk's Client tab follows the page you are on. **Keep on Desk** holds one client there instead, so you can look at another client's page, your Inbox or Slate while that client stays in the Desk.

- On the Client tab, click **Keep on Desk** next to the client's name (it then says **Kept**). Click **Kept** to stop.
- On a client's page, the **Keep on Desk** button in the page header, the **p** key, or **Keep <client> on Desk** in the search box (⌘K or Ctrl+K) does the same, and opens the Desk on that client.
- While a client is kept and you open another client's page, the Desk says **Kept · you're on <other client>** with a **Show <other client>** button to look at the page's client for a moment.
- Picking another client in the Client tab moves the keep to that client, with **Undo**.
- A keep lasts 24 hours, then the Client tab follows the page again.
- If you lose access to a kept client, the Desk says **You can't see this client anymore** with a **Stop keeping** button, and shows nothing about the client.

Keep is yours alone and saved in this browser. It is separate from the ☆ pins, which keep clients at the top of the client list.

## Customize Desk

The sliders button in the Desk head (next to ×) opens **Customize Desk**. It is saved for you in this browser.

- **Glance counts at the top** and **Right now card**: turn either off.
- **When the Desk is closed, show**: **Both** (the rail and the bar, the default), **Rail only**, **Bar only** or **Neither**. With either one hidden, press **D** to open the Desk. On a phone the bar always shows.
- **Reset Desk** puts your Desk back to the defaults: width, tab, keep, the summary's fold and these choices. Your ☆ pins stay.

## Tip (tips.md row, at launch)

| Desk Client tab (only while the Desk client summary is on) | Keep on Desk holds this client on the Client tab while you open other pages, for up to 24 hours. On a client's page, press p to do the same. | [How do I use the Desk?](#/help/workbench) |
