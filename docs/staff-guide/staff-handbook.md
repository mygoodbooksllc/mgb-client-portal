---
title: How do I sign the Staff Handbook?
section: Daily work
audience: staff
keywords: [handbook, staff handbook, policy, policies, sign, signature, sign policy, countersign, countersigner, account manager, re-sign, resign, needs re-signing, overdue, flexible work, scheduling, sla, effective date, signed copy, pdf, download, version, version history, minor edit, staff reviews drive, publish, new version, publish new version, status grid, signatures by bookkeeper, not filed, retry filing, change note, reference, reference policy, signed policy, policy kind, new policy, add a policy, create policy, draft, drafts, publish draft, section, sections, search policies, policies to sign, edit details, make this a signed policy, link name]
sort: 146
---
The firm's staff policies live on the **Handbook** tab of **Team** (`#/team/handbook`). Anyone on the team can read them. The number on the tab shows what's waiting on you.

A policy is one of two kinds:

- **Signed**: bookkeepers sign it in the portal, and the Account Manager countersigns. The first one is **Flexible Work, Scheduling & Operational SLA Policy**.
- **Reference**: read only. It has versions like any policy, but nobody signs it, and it never adds a Today row, a number on the tab or an email.

The list starts with **Policies to sign**, then the reference policies grouped by section (**General** for those without one). Type in **Search policies** to filter by title, section or link name.

### Sign a policy (bookkeepers)

1. Open **Team › Handbook** and click the policy, or click its **Sign** row on **Today**.
2. Read it to the end. The sign panel at the bottom unlocks once you've scrolled to the end of the text.
3. Tick **I have read and agree to this policy, and I agree to sign it electronically.**
4. Type your full name as it appears on your staff profile. Capitals and extra spaces don't matter.
5. Click **Sign**.

Until you sign, the policy reads *Date of signing* where the Effective Date goes and *Your name* where your name goes. Your Effective Date is the day you sign.

The portal records the version you signed, your typed name, the sentence you agreed to, the time, your IP address and your browser. After you sign, the policy shows **Awaiting countersign** until the Account Manager signs too, then **Signed**.

Only bookkeepers sign. Admins and other staff can read every policy, but they're never asked to sign.

### Countersign (the Account Manager)

When a bookkeeper signs, the countersigner gets a **Countersign** row on **Today**, an email, and a **To countersign** list on the Handbook tab.

1. Click the row, or the name under **To countersign**.
2. In the policy, under **To countersign**, tick **I countersign this policy on behalf of MyGoodBooks, and I agree to sign it electronically.**
3. Type your full name and click **Countersign**.

That completes the signature, and the portal files the signed copy.

### Your signed copy

When the countersignature lands, the portal builds a PDF once and saves it to the **Staff Reviews** Shared Drive under **Handbook / <Policy>**. That drive is admin-only. The PDF shows the policy text as signed, the version, your Effective Date, both typed signatures with time, IP and browser, and a fingerprint of the exact policy text.

To get your copy, open the policy and click **Download signed copy** under **My signatures**. If it says the copy is still being filed, try again in a minute.

### When a policy changes

A new version of a policy is one of two kinds (an admin picks one when publishing):

- **Needs re-signing**: every bookkeeper gets a **Sign** row on **Today**, a number on the Handbook tab and one email. You have 7 days to sign the new version. After that, the row says **Overdue**. Nothing is locked; it just stays on your list until you sign.
- **Minor edit** (a typo or formatting): nobody re-signs. Your signature stays tied to the version you signed, and you aren't asked to sign the edit.

Your older signed copies are kept. **Version history**, at the bottom of each policy, lists every version with its date, its kind and **Signed by you** on the ones you signed. Click **View** to read an older version.

### Emails

**Settings › Notifications › Staff Handbook signatures** turns the handbook emails on or off (on to start with). The Today row and the tab number stay either way. The email only links to the portal; it never includes the policy text.

### For admins

- The top of the Handbook tab shows who countersigns, or **No active countersigner set**. While nobody is set, signatures wait for a countersigner. **Change** (or **Set countersigner**) picks an active staff member. Open countersign items move to the new person.
- **Signatures by bookkeeper**, at the bottom of the Handbook tab, is a grid with policies down the side and active bookkeepers across the top. Each cell shows **Signed**, **Awaiting countersign**, **Needs re-sign**, **Overdue** or **Not signed**, with the date (countersigned, signed, or due). On a phone, swipe the grid sideways. Click a policy name to open it.
- Each policy also lists every bookkeeper's state. Click **Download** for anyone's signed copy.
- **Not filed to Drive yet** appears when a countersigned copy hasn't reached the Staff Reviews drive. It usually files within a minute. **Retry filing** unlocks 2 minutes after the countersignature; click it to try again. If it stays, check Google Drive in Dev Tools.
- Every sign, countersign, publish, new policy, details change, countersigner change and download is in the [Audit log](#/help/audit-log) under **Staff Handbook**.

### Add a new policy (admins)

1. On the Handbook tab, click **New policy**.
2. Type the **Title**. The **Link name** (the policy's address, like `#/team/handbook/paid-time-off`) fills in from the title. You can change it before saving: lower-case letters, numbers and hyphens, 2 to 81 characters. It can't change later.
3. Pick the **Kind**: **Reference** (the default; nobody signs it) or **Signed**.
4. Optionally type a **Section**, such as *Time off*. Sections you've used before are suggested.
5. Write the **Policy text** in Markdown. The preview on the right shows it the way staff will see it.
6. Click **Save draft**.

A new policy is always a **draft** first. Only admins see drafts (in a **Drafts** group at the bottom of the list), and nobody is emailed. To change the text, open the draft and click **Edit text**. When it's ready, click **Publish** on the draft and confirm:

- A reference policy is then visible to everyone. Nobody is emailed.
- A signed policy asks every active bookkeeper to sign: one email each, a Today row and a badge, and 7 days to sign.

Creating a policy never emails anyone. Only **Publish** does, and only for a signed policy.

### Edit details or change the kind (admins)

- **Edit details** (on any policy) changes the title, the section and the **Order** (lower numbers list first within their group). The link name stays the same, so links in old emails keep working.
- **Make this a signed policy** (on the latest version of a reference policy) starts asking for signatures. Write a change note, tick the box, and click **Make it a signed policy**. The current text is published again as a new version that every bookkeeper signs (each gets one email and has 7 days). This can't be undone: a signed policy can't go back to reference.
- New versions of a reference policy are always minor edits: nobody is asked to sign them.

### Publish a new version (admins)

1. Open the policy on its current version and click **Publish new version**.
2. Edit the text on the left. It's Markdown, and the preview on the right shows it the way staff will see it. Keep `{{effective_date}}` and `{{employee_name}}` where the signing date and the signer's name go.
3. Write a one-line **Change note**. Everyone sees it in **Version history**.
4. Choose **Needs re-signing** (every bookkeeper gets one email, a Today row and a badge, and has 7 days) or **Minor edit** (nobody is emailed or asked to re-sign).
5. Click **Publish version N**, read the confirmation, and click **Yes, publish**.

Published versions can't be edited or deleted, so check the preview first. The portal won't publish text that's identical to the current version. On a reference policy you won't see the two choices: its versions are always minor edits.

If you leave the editor before publishing, your unsaved text comes back the next time you open it in the same browser tab. If another admin publishes while you're editing, the portal stops you from publishing over their version: copy what you want to keep, click **Cancel** and start again. A bookkeeper who joins after a version is published gets 7 days from the day they joined.

### Troubleshooting

- **"Type your full name exactly as it appears on your staff profile."** Your typed name has to match your name on the staff list (**Team › Members**). Capitals and extra spaces don't matter. Ask an admin if it looks wrong.
- **"A newer version of this policy has been published."** Reload and sign the latest version.
- **"You have already signed this policy."** Only minor edits came after the version you signed, so there's nothing to sign.
- **"Check the box to agree before signing."** Tick the agreement, then sign.
- **The sign panel stays locked.** Scroll all the way to the end of the policy text.
- **"The signed copy is still being filed."** The PDF is saved right after the countersignature. Try again in a minute.
- **"Google Drive isn't connected yet."** The Staff Reviews drive isn't set up. Tell an admin. See [How do I set up Google Drive for staff reviews?](#/help/review-drive-setup).
- **I'm an admin and I don't see a Sign button.** Only bookkeepers sign.
- **There's no Sign button on this policy.** It's a reference policy (it says *For reference. Nobody needs to sign this policy.*). There's nothing to sign.
- **"Another policy already uses this link name."** Pick a different link name for the new policy.
- **I can't find a draft.** Drafts are only on the Handbook tab for admins, in the **Drafts** group. Clear the search box.
