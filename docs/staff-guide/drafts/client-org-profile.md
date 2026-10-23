---
title: What is a client's organization profile, and how do client gifts work?
section: Admin
audience: staff
keywords: [organization profile, org profile, client profile, card name, gift, gifts, client gifts, anniversary, anniversaries, client since, established, founded, fiscal year end, main contact, courier, delivery, get to know, favorite treat, allergies, budget, import, dry run]
sort: 552
---
DRAFT - not live until the owner flips tk_settings.org_profile_enabled. Not in the guide table yet: at launch, drop this header line, move the file to docs/staff-guide/client-org-profile.md and sync it with a targeted guide SQL (upserts only). Until then each person can try it with **Client org profile + gifts (preview)** in Settings › Firm settings › Developer tools › Feature flags.

A client's **organization profile** holds the few details we need to address things to them correctly and mark their milestones: the name for cards and gifts, the kind of organization, when it was established, where gifts go, who receives deliveries, a main contact and the fiscal year end. Nothing in it emails anyone or orders anything.

### What clients see

- When a client signs in and their profile isn't finished, a short form opens: **Finish your organization profile**. It takes about two minutes. **Later** puts it off until their next sign-in, and they can save part of it and finish later.
- Until it's finished, their Home shows **Finish your organization profile** under Needs you, and their **?** menu has **Organization profile**.
- **Get to know you** questions (favorite treat, coffee or tea, allergies, hobbies, a note for the team) are optional. Once sent, the client never sees the answers again; sending new ones replaces them.
- Clients you are viewing as, previewing or impersonating never get the form.

### For everyone on staff

- A client's **Overview** has an **Organization profile** card under Key dates. The pill says **Not started**, **Incomplete** or **Complete**.
- If the client's fiscal year end differs from Key dates, the card says so. Key dates is never changed for you: check with the client and update Key dates yourself if needed.
- **Client since** comes from the client's launch date. Use **Edit** to set it by hand (for clients who started before the portal), and **Use launch date** to go back.
- **Get to know them** answers show only to admins, the client's assigned bookkeeper and the account manager. Everyone else sees that answers are in, not what they say.
- The client's onboarding checklist shows **Client finished organization profile**, ticked by itself when the profile is complete. You can't tick it by hand.

### For admins

**Team › Client gifts** (real admins only; not during View as) has:

- **Anniversaries in the next 30 days.** Each client's Client since anniversary, and their Founded anniversary when they gave an established date. For each row: **Plan** (item, amount, notes; the amount starts at $40), **Mark sent** and **Skip**. The pill shows **Not planned**, **Planned**, **Sent** or **Skipped**. An amount outside the usual $30-45 budget gets a note but still saves.
- **Past gifts.** What was sent or skipped, with who marked it sent and when.
- **This week's digest line.** The weekly digest shows "Anniversaries coming up: N clients" while the firm switch is on.
- **Import dry run.** Paste the old anniversary sheet as CSV to see how many rows match a client, which don't, and which have bad dates, a missing city or ZIP, or a PO box. Nothing is saved: the real import waits for owner approval.

Nothing on this page emails clients or orders gifts. Buy and send the gift the usual way, then **Mark sent**.
