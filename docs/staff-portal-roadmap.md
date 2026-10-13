# Staff portal roadmap: next features

Owner wish list, written 2026-10-13. Nothing here is built yet. Each section says what the
feature is, what each side of the portal sees, what it builds on, and the questions to answer
before building it.

## Already in place (don't rebuild)

- **Client profitability and hours budgets.** `client_fees`, `staff_cost_rates`,
  `client_profitability()` and `client_profile.monthly_hours_budget` (admin only). The scope
  flags in section 2 use these numbers instead of adding new ones.
- **"Ask about a transaction."** `components/client/TxnQuestions.jsx`. Clients explain a
  transaction and staff resolve it. Section 3's request checklist reuses its pattern.
- **Firm deadlines.** `firm_deadline_rules`, per-client overrides and "Mark filed". The year-end
  hub plugs its due dates in here.
- **Client onboarding steps, staff onboarding, SOPs, Drive document pointers**
  (`client_documents`), audit log, staff chat, time off and coverage, celebrations.

## Suggested order

| # | Feature | Size | Why this slot |
|---|---------|------|---------------|
| 1 | Year-end hub | Large | Giving statements, 1099s and W-2s are due January 31. It needs to be ready by early December. |
| 2 | Announcements and handbook | Small | Quick win, and can be built alongside #1. |
| 3 | Agreements, scope flags and prospect pipeline | Large | The biggest piece of new value. Start in January, after year-end. |
| 4 | New client packet | Medium | Goes at the end of the pipeline, so it follows #3. |
| 5 | Restricted fund alerts | Medium | Builds on the fund accounts that already exist. |
| 6 | Certification badges | Small | Fill-in work whenever there's a gap. |
| 7 | Quarterly access review | Small | Fill-in work. Its data mostly exists already. |

---

## 1. Year-end hub

One page per client per year. It lists every year-end item, who owns it, its status, and what
we're still waiting on from the client.

**Staff side** (Work › Close, a new "Year-end" view, plus a firm-wide board):
- A row for each item that applies to the client: **Not started → Waiting on client → In
  progress → Review → Delivered**, with owner and due date.
- A firm-wide board: every client × every item, so an admin can see in December which
  clients are behind.
- The items that apply depend on entity type (`client-entity-type.sql`). Churches don't file a
  990, but most other nonprofits do.

**Items to track:**
- **Donor giving statements:** draft from QuickBooks donor gifts (`qbo-donor-gifts.sql`).
  Check donors with missing addresses, then deliver. Due January 31.
- **1099-NEC / 1099-MISC:** list vendors paid over the threshold, track W-9 status (requested,
  received, missing), then file. **Check the current threshold:** it went from $600 to $2,000
  for payments made in 2026.
- **W-2 / W-3 and payroll year-end:** confirm with the payroll provider. This is often a
  confirmation step, not a filing step for us.
- **Clergy housing allowance:** the board resolution for the *next* year has to be adopted
  before January 1. Remind the client in November.
- **Form 990 / 990-EZ / 990-N:** the prep checklist and the handoff to the client's CPA, if
  they use one.
- **Year-end close and audit or review prep:** the December close plus a "PBC" (prepared by
  client) document list.

**Client side:** a "Year-end" card listing what we need from them (W-9s, the housing
allowance resolution, donor address fixes), with upload or reply on each item. It works like
transaction questions: whatever they send lands in the staff Inbox.

**Builds on:** firm deadlines (due dates), month close, QuickBooks donor gifts, the client
messages and notification emails setup, and Drive document pointers.

**Open questions:**
- Do we produce giving statements in the portal (PDF per donor), or only track them while
  they're made in QuickBooks or a church management system?
- Should we request W-9s from vendors directly, or have the client collect them?
- Which items cost extra? This links to the scope flags in section 3.

---

## 2. Announcements and handbook

**Announcements** (new Team › Announcements page, plus a card on Today):
- Admins post with a title, body and optional attachment. They can pin a post and can mark it
  **"Requires acknowledgment."**
- Staff see unread posts at the top of Today. Posts that need acknowledgment stay there until
  the person clicks "Got it."
- Admins see who has read or acknowledged each post. Email goes out through the existing
  notification emails.
- This is one-way communication from the company. Discussion stays in staff chat.

**Handbook** (Team › Handbook, also linked from the Staff guide):
- Sections with full version history, the same pattern as client SOPs and `client_sop_history`.
- When a section changes in a meaningful way, staff are asked to acknowledge the new version.
  Reading the handbook becomes a step in new-hire onboarding (`staff_onboarding_steps`).
- Suggested sections (there are no benefits, expense or PTO policies to cover):
  - How MyGoodBooks works: mission, the clients we serve, and how work is assigned
  - Client communication: tone, expected reply times (ties to Reply times), escalation
  - Confidentiality and data security: devices, passwords, donor data, no personal email
  - Time logging in QuickBooks Time: what to log and how to describe it
  - Availability and coverage: how to mark time away so coverage works
  - Quality standards: the close checklist, review expectations, and what "done" means
  - Scope: what to do when a client asks for something outside their agreement (section 3)
  - Who to ask about what
- **If bookkeepers are contractors**, write the handbook as standards and expectations, not
  employee rules, and have someone check the wording.

**Open questions:** should acknowledgments block anything (for example, Today stays
nagging), or only be tracked?

---

## 3. Client agreements, scope flags and prospect pipeline

### 3a. Agreements, client side ("Your agreement" page)

A page in the client portal that holds:
- **Every signed document:** engagement letter, renewals, add-on agreements and any other
  paperwork, with the date signed and who signed it. Files stay in Drive, as
  `client_documents` already works.
- **What they are paying us to do,** in plain language. It comes from a structured service
  list, not a paragraph. For example:
  - Monthly close by the 15th
  - Bank and card reconciliations: **up to 3 accounts**
  - Payroll for **up to 10 employees**
  - Year-end giving statements
  - 1099s: **up to 15 vendors**
  - Monthly report packet, plus one board meeting packet per quarter
- **What isn't included,** listed just as clearly (for example cleanup of prior years, grant
  reports, budget building), with a "Request this" button.
- **Their current fee and the next price review date.**

### 3b. Agreements, staff side

- Admins build the agreement from a **service catalog**. Each service has a name, a
  description, a unit and limit (accounts, employees, vendors, packets each month) and a
  price. The milestone pricing tiers fill in the defaults.
- Every change creates a **new version**. The client signs or accepts it, and the old versions
  stay visible.
- The agreed fee becomes the source for `client_fees`, so profitability stays in sync.

### 3c. Scope flags

Two kinds of flags:

**Automatic:**
- More bank or card accounts connected in QuickBooks than the agreement covers
- More payroll employees or 1099 vendors than covered
- Hours over `monthly_hours_budget` for 2 months in a row (this data already exists)
- A task or client request in a category the agreement doesn't include

**Manual:** on any client message, task or transaction question, a bookkeeper clicks **"Outside
scope?"** and adds a one-line note.

**What happens with a flag:** it goes to the account manager or an admin, who picks one of:
- **Absorb:** do it this once and log it, so it shows up at the next price review.
- **Quote an add-on:** send the client an add-on agreement from 3a.
- **Decline:** answer the client with a polite, templated reply.

A per-client **scope log** feeds the yearly price review.

**What the client sees:** when a client's request is outside their agreement, the reply
points them to the "Request this" option instead of the work quietly being done.

### 3d. Prospect pipeline (staff side, Clients › Prospects)

Stages: **Inquiry → Discovery call → Proposal sent → Engagement letter sent → Signed → Becomes
a client.**
- The proposal is built from the same service catalog, so the signed proposal *is* the first
  agreement.
- Signing creates the `clients` row, starts client onboarding, and sends the new client packet
  (section 4).
- Track source, estimated fee, and why a prospect was lost.

**Open questions:**
- E-signature: DocuSign, or a simple "I accept" in the portal (name, date and time, which
  version)? The simple option is probably enough for engagement letters. Check with whoever
  advises MyGoodBooks on contracts.
- Should clients see their hours used, or only the services list?
- Who gets scope flags: the account manager, the admin, or both?
- `client_fees` is admin-only today. The client's view needs its own read of *their own* agreed
  fee, not access to that table.

---

## 4. New client packet

Everything a new client gets, and everything we need from them, in one place.

**Client side:** a welcome checklist that appears right after signing:
- Welcome letter and "how working with us works" (when the close happens, how to ask
  questions, response times)
- What we need from you, each with upload or "done":
  - QuickBooks accountant access, bank and card access (read-only), payroll provider access
  - Last year's financial statements, 990 and audit, if any
  - Board-approved budget, list of designated funds and restrictions
  - Donor or church management system export, W-9s on file
  - Signed housing allowance resolution, for churches
- Who's on their team at MyGoodBooks, with photos

**Staff side:**
- **Template library:** a standard chart of accounts for churches and one for nonprofits, a
  standard set of bank rules, a fund and class setup, and a starting SOP outline. "Apply to
  this client" copies them into the client's SOP and setup notes. It does **not** write to
  QuickBooks, which stays read-only as it is today.
- The packet checklist ties into the existing client onboarding steps, so progress shows in
  one place.

**Open questions:** do the templates live as SOP-style text, or as downloadable files
(an importable chart of accounts spreadsheet)?

---

## 5. Restricted fund alerts

- For each designated or restricted fund (`client-fund-accounts.sql`), show balance, income and
  spending.
- **Alerts:**
  - A fund goes negative.
  - Spending is coded to a restricted fund in a category that doesn't match its purpose (the
    purpose is set per fund).
  - A fund hasn't moved in 12 months (stale designation).
- Alerts show on the client's staff overview and in Close checks before a close can be marked
  done.
- **Client side:** a read-only fund balance summary, if it isn't already shown under Giving and
  Funds.

**Open question:** do we flag only, or also block the close until someone clears the flag?

---

## 6. Certification badges

- **Admin-managed catalog:** QuickBooks Online ProAdvisor (Level 1, Level 2, Advanced),
  QuickBooks Payroll, Certified Bookkeeper (AIPB or NACPB), nonprofit accounting courses, and
  internal courses.
- **Each person adds** what they've earned: date, expiry date, and a proof link (Drive or a
  certificate URL). An admin verifies it.
- **Verified badges show** on the person's card in Team › People and on their profile.
  Expired badges grey out.
- Reminders go out 30 days before a certification expires (ProAdvisor renews every year).
- **Later:** internal "courses," where reading a set of SOPs plus a short quiz earns an
  internal badge. Admins could also require a badge before someone is assigned a certain type
  of client.

---

## 7. Quarterly access review

- Every quarter, a task for admins: one screen listing every client, with assigned staff and
  client portal users.
- Each person gets a **Keep** or **Remove** decision. Temporary admin access that should have
  ended (`staff-temp-admin-access.sql`) is flagged automatically.
- Completing the review writes one audit log entry with who reviewed it and when.

---

## Before building any of these

Each one follows the repo's usual pattern: a numbered SQL file in `supabase/` with row-level
security (clients only ever see their own org, and money is admin-only), a component prefix
for shared global scope, a Staff guide article, and tour or tips updates where it matters.
