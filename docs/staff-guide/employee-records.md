---
title: How do I keep employee records?
section: Admin
audience: admin
keywords: [employee records, employee record, hr, hr record, personnel file, staff record, legal name, job title, employment type, w-2, w2, contractor, full time, part time, schedule, manager, hire date, start date, end date, work location, personal email, personal phone, home address, emergency contact, notes, complete, missing details, no record yet, former staff, handbook signatures]
sort: 525
---
**HR › Employee records** (`#/hr/employees`) keeps one record per staff member: job details, personal contact details and an emergency contact. Only admins see it. A temporary admin grant doesn't open it, and neither does **View as**.

Pay, Social Security numbers and bank details don't go here. There's no field for them, so keep them in payroll.

### The list

Everyone on the staff list appears, active staff first. Each row shows the job title, employment type, schedule, manager and hire date, plus one of:

- **No record yet**: nobody has started a record for this person.
- **9 of 13** (for example): the record is missing some details. Hover to see which.
- **Complete**: every detail is filled in (end date and notes don't count).

The line at the top counts active staff who are complete, missing details, or have no record yet. Use the search box (name, title or manager) and **Active staff / Former staff / Everyone** to narrow the list. The list never shows personal contact details. Opening the list is logged in the [Audit log](#/help/audit-log) too (who and when, nothing from the records).

### Open and edit a record

1. Click a person. Their record opens. Opening it is logged in the [Audit log](#/help/audit-log) under **Employee records**.
2. Click **Edit** (or **Start a record** if there isn't one yet).
3. Fill in what you know. Every field is optional:
   - **Job**: legal name, job title, employment type (**W-2 employee** or **Contractor**), schedule (**Full time** or **Part time**), manager, work location, hire date, end date.
   - **Personal contact**: personal email, personal phone, home address.
   - **Emergency contact**: name, relationship, phone.
   - **Notes**: anything else worth keeping, up to 4,000 characters.
4. Click **Save changes** (or **Save record**).

Clearing a field and saving removes that value. The Audit log records which fields changed, never what they say.

### Hire date, start date and end date

- Saving a **hire date** also sets the start date on the person's profile, which work anniversaries and the **This week** card use. Clearing the hire date leaves the profile's start date alone.
- **Offboarding** fills in the **end date** with the offboarding day when the record has none, and logs it in the Audit log. An end date you entered yourself is never replaced. See [How do I offboard a staff member?](#/help/offboarding).
- The end date can't be before the hire date.

### Handbook signatures

Below the record, **Handbook signatures** shows where an active bookkeeper stands on each policy they sign (**Signed**, **Awaiting countersign**, **Needs re-sign**, **Overdue** or **Not signed**). It's read only. Click a policy to open it. Reference policies aren't listed, because nobody signs them. See [How do I sign the Staff Handbook?](#/help/staff-handbook).

### Troubleshooting

- **I don't see the Employee records tab.** It's for admins only. A temporary admin grant doesn't include it, and it's hidden while you use **View as**.
- **"Employee records are for admins only."** Your account isn't an active admin. Ask the owner.
- **"Someone can't be their own manager."** Pick someone else, or **No manager**.
- **"The hire date is out of range."** Use a date from 1950 to a year from today.
- **"Use digits, spaces and + ( ) - . only."** Phone numbers can't include letters. Put extra words in **Notes**.
