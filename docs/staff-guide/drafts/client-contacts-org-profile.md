# People to contact: DRAFT guide text (held)

> **PUBLISHED 2026-11-06** (label 2026-11-06c, launch of six previews). The live text is in `docs/staff-guide/` and `supabase/launch-2026-11-06.sql`; this draft is kept for reference.

Draft for the hidden Org profile contacts preview (Feature flags label "Org profile contacts (preview)", localStorage `mgb_orgcontacts_preview`; firm switch `tk_settings.org_contacts_enabled`, owner-only). Publish at launch, when the owner flips `org_contacts_enabled`: fold this into the `client-org-profile` article (or add it as its own section), and sync the guide rows then. Do not copy into the live guide or Supabase `staff_guide` before that.

## People to contact (in the Organization profile card)

**Where:** a client's Overview › Organization profile › **People to contact**.

This is the one list of people we email for a client. The client keeps it up to date in their org profile, and you can add or fix people here.

- **Main contact.** Exactly one. Monthly reports go here. To change who it is, edit another person and tick **Main contact**. If you remove the main contact, the client is asked to pick a new one.
- **Monthly emails.** This person is preselected in the To line of monthly email drafts.
- **Can answer requests.** This person can be sent Ask client links. People the client adds start with this off unless the client ticks it.
- **Title** is what the client sees (for example Treasurer or Pastor). **Role** and **Notes** are for staff only; the client never sees them. Do not put private remarks in Title.
- **Added by client** marks people the client added. **Opted out** means they turned off portal emails; they are never preselected.
- Rows marked **Portal login** or **from org profile** are read-only here. Ask the client to update their org profile, or add the person here.

Changing someone's email, turning off Can answer requests, or removing them stops any open Ask client links sent to them.

**Greeting name.** What we call the main contact in emails ("Hi Pastor Jim"). If it differs from the Client info greeting, the card flags it.

**Where else this shows.** The Review board's contact list (the ▸ arrow) and the To chips in email drafts read this list, with where each person came from. The tasks drawer and Ask client use the same contacts.

Changes on real clients need a real admin while this is in preview. View as never changes anything.
