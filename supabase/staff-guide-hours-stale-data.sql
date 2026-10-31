-- staff-guide-hours-stale-data.sql
--
-- Team > Hours interim stale-data fix (2026-10-31): capacity (no This week column, complete weeks only, monthly-paid
-- note), team-page (Hours synced through line, Avg / mo wording) and whats-new (new entry). Keywords unchanged.
-- capacity and team-page replace body_md whole; whats-new inserts the new entry above the newest one. Each block writes only when the live md5 still equals the md5 read on 2026-10-31, then checks the md5 of
-- the result equals the repo file. If a live article changed since, the block raises and nothing is written.
-- Replaces only; never deletes. body_plain is generated, never updated.
--
-- Applied to production 2026-10-31 (team-page ran as targeted replaces; result md5 identical).
do $$
declare n int;
begin
  update public.staff_guide set body_md = $q$The **Capacity** card on **Team** (admins only) compares each person's average QuickBooks Time hours per week with their weekly target.

### Reading the card

Columns: Name, **Target / wk**, **Avg / wk (4 wks)**, **Utilization**, Clients, Open and Overdue tasks.

There is no "this week" column on purpose. QuickBooks Time hands hours to QuickBooks Online when a pay period is approved, so the newest days are not in yet and the current week would show zero for everyone. The average uses only the last 4 **complete** weeks (Monday to Sunday) that have fully synced, never the current week. On **Team › Hours**, a line under the period tabs says **Hours synced through** the newest day the portal has.

People who are paid monthly (Gillian) show **Paid monthly, hours post at month end** instead of an average and a utilization bar, because their hours reach QuickBooks only at month end. Who is paid monthly is a short list in the code (`TH_MONTHLY_PAID_EMAILS` in `components/staff/teamHoursLogic.js`); there is no pay-frequency field yet, so ask to have someone added.

Open and Overdue count by who the task is assigned to now. (The Overdue column is hidden during the late-task grace period.) While someone is out, tasks handed to a backup count for the backup until they go back. See [What happens to my tasks while I'm out?](#/help/out-of-office-handoff).

Utilization uses the 4-week average:

| Label | Meaning |
|---|---|
| **Has room** | Under 70% of target |
| **OK** | 70% to 100% |
| **Overloaded** | Over 100% |

### Change someone's weekly target

The default is **35 h**. Click **Edit** next to their target, enter 0–100 hours and save.

### Workload hint on HR → Members

When assigning clients on **HR → Members** (formerly Staff Access), the Clients column and the "{name}'s clients" window show a small workload bar with **Has room** / **Overloaded**, so you can balance assignments.

### Troubleshooting

- **"Weekly targets aren't set up on the server yet, so everyone uses 35 h."** A database update is missing; everyone uses the default until it's applied.
- **"QuickBooks Time isn't connected, so there are no hours to compare with targets yet."** See [How do I connect the firm's QuickBooks Time?](#/help/firm-quickbooks).
$q$, updated_at = now()
  where slug = 'capacity' and md5(body_md) = 'b16cfc335928b1a0f583960954117be7';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'capacity changed since it was read (md5 mismatch)'; end if;
  if (select md5(body_md) <> '8eb8ad5c3f0b9853a4b68bcfffc55d88' from public.staff_guide where slug = 'capacity') then
    raise exception 'capacity: result does not match the repo file';
  end if;

  update public.staff_guide set body_md = $q$**Team** (in the left rail, or `#/team`) is about the people you work with and the firm's numbers. Everyone gets People, Performance and Inventory. Admins also get Hours, Reply times, Feedback and Ledger review. The tab is part of the address (`#/team/people`, `#/team/hours` and so on).

The staff paperwork has its own place: **HR**, right below Team in the left rail. See [What's on HR](#hr-handbook-reviews-onboarding-and-people-records) below.

### For everyone

- **People** (opens first): **Team load** at the top (open, due this week and late for each person, the **Unassigned** count and the next 4 weeks; admins and account managers see everyone, others their own row; see [Profiles, one search and Team load](#/help/slate-profiles)), then **Who's out** today and in the next 30 days, **My clients' backups** (who covers each of your clients, and whether they can open it), **My time off** with **+ Add time off** and **Hand my tasks to backups**, and **Shout-outs**. See [How do I add time off and make sure my clients are covered?](#/help/time-off-coverage), [What happens to my tasks while I'm out?](#/help/out-of-office-handoff) and [How do I give a teammate a shout-out?](#/help/shoutouts).
- **Performance**: your score and the inputs behind it. Admins see everyone, ranked. See [How does Team › Performance score bookkeepers?](#/help/performance).
- **Inventory** (`#/team/inventory`): the equipment you have, requests for new equipment, and the standard home-office setup. Admins also get the whole team's inventory, a roster of who's missing what, the staff directory and **Export to Google Sheet**. See [How do I request equipment or log what I have?](#/help/tech-inventory).

### Admins only

- **Hours** (`#/team/hours`): hours and tasks by person and by client, with the QuickBooks Time connection and the QuickBooks API usage card. Details below.
- **Reply times** (`#/team/reply-times`): how fast we answer client messages, by person and by client, and who's waiting over 24 hours. See [How do I read reply times?](#/help/reply-times).
- **Ledger review** (`#/team/ledger`): Ledger review settings: warn or block when a month is marked done without approval, how much ledger to pull, Smart or Strict duplicate checks, and the vendor watch list. Only admins see this tab. See [How does Ledger review work?](#/help/ledger-review).
- **Feedback** (`#/team/feedback`): every bug report and idea staff have sent, with status and replies. The number on the tab counts reports still marked **New**. See [How do I review bug reports and feedback?](#/help/feedback-page).
- **Teams** (on **People**, under Team load): make teams, add people, rename or archive them. Teams show on each person's profile. Managers come from **HR › Employee records**. See [Profiles, one search and Team load](#/help/slate-profiles).

### HR: Handbook, Reviews, Onboarding and people records

**HR** (in the left rail, or `#/hr`) holds the staff paperwork. It used to be tabs on Team (2026-10-19). Everyone gets Handbook, Reviews and Onboarding. Admins also get Members, and real admins get Employee records. The tab is part of the address (`#/hr/handbook`, `#/hr/reviews` and so on). The number next to HR in the rail adds up what's waiting on you under Reviews and Handbook.

**Old links still work.** A link or email that points at `#/team/handbook`, `#/team/reviews` (including a single review and the survey), `#/team/onboarding`, `#/team/employees` or `#/team/members` opens the same page under HR, and the address bar changes to `#/hr/...`. Bookmarks keep working too.

#### For everyone

- **Handbook** (`#/hr/handbook`): the firm's staff policies. Bookkeepers read and sign each one, and the Account Manager countersigns. Policies are **Signed** (bookkeepers sign) or **Reference** (read only), grouped by section, with a search box. The number on the tab shows policies waiting for your signature or countersignature. Admins also get **New policy** (saved as a draft only admins see until **Publish**), who countersigns, a grid of every bookkeeper's state, any signed copies not filed to Drive yet (with **Retry filing**), and **Publish new version** on each policy. See [How do I sign the Staff Handbook?](#/help/staff-handbook).
- **Reviews** (`#/hr/reviews`): your quarterly review, your history and the team survey. Admins also get Team status, Reviews I'm giving, Survey results and Year-end. The number on the tab shows what's waiting on you. See [How do quarterly reviews work?](#/help/quarterly-reviews).
- **Onboarding** (`#/hr/onboarding`): your new-hire checklist, **Your onboarding**. Admins also see each person's progress and can edit the steps. See [How does the new-hire onboarding checklist work?](#/help/new-hire-onboarding).

#### Admins only

- **Employee records** (`#/hr/employees`): one record per staff member with job details (title, type, schedule, manager, hire and end dates, work location), personal contact details and an emergency contact, plus their handbook signatures (read only). Admins only: a temporary admin grant and **View as** don't show it (nor **Members**). Opening a record is logged. See [How do I keep employee records?](#/help/employee-records).
- **Members** (`#/hr/members`): add staff, roles, active/inactive, client assignments, temporary admin access, **View as** (read-only, real admins only), **Last seen** (admins only) and **Offboard**. Temporary admins see it read-only, without View as or Last seen. See [How do I add staff and manage their access?](#/help/staff-management).

Client health has no tab of its own any more: the **Clients** page shows every client's score and band, and its **Needs attention** filter picks out the ones to look at. See [What does client health mean?](#/help/client-health).

### Hours, top to bottom

1. **QuickBooks Time** panel: the firm's QuickBooks connection. See [How do I connect the firm's QuickBooks Time and match customers and staff?](#/help/firm-quickbooks).
2. **QuickBooks API usage** card: calls to QuickBooks this month against Intuit's limit. See [How do I read the QuickBooks API usage card?](#/help/quickbooks-api-usage).
3. A link to **Emails** (weekly digest and client email settings live there).
4. Period tabs: **This week**, **This month** (default), **Last month**, **Custom range**. Use **People CSV** / **Clients CSV** to export.
5. A summary line: hours in QuickBooks Time and hours active in the app (automatic, not billed), then **Hours synced through** the newest day QuickBooks has handed over. Hours lag: QuickBooks Time passes them to QuickBooks Online when a pay period is approved, so the last few days can be missing and the **This week** tab often reads 0:00 until they arrive. That is a delay, not zero hours. Anyone paid monthly (Gillian) shows **Paid monthly, hours post at month end** in the **People** table's QB hours instead of 0:00.
6. **Capacity** card. See [How do I check team capacity?](#/help/capacity).
7. **People** table, then **Clients** table.

Temporary admins see the tab without the money figures.

### Hours: where they come from

- **QB hours** come only from QuickBooks Time. Nobody logs time in this app.
- **In app** is automatic active time on client pages. It is not billed time.

**Late tasks:** while the late-task grace period is on (the default), the Overdue columns, tiles and CSV columns on this page are hidden, because late tasks are not counted against anyone yet. They come back when the owner turns counting on in **Settings › Firm settings**.

### People table

Name, QB hours, In app, Billable, On clients, unmapped customer hours, Open, Overdue, Completed tasks, and Clients (with "+N temporary"). Rows tagged **Unmapped**, **Ignored**, **No customer** or **No person** collect hours that aren't matched yet; click **Map them** to fix.

Click a person to see their QB hours, billable hours, in-app time by client, tasks (Overdue, Open, Completed in period) and their **Loaded hourly cost**.

### Clients table

Client, Plan, QB hours, In app, Avg / mo (the average of up to the last 3 complete months that have fully synced, so a month the sync hasn't finished never pulls it down), Trend (for example "▲ 20% vs avg"), Billable value, Fee / mo, **vs milestone** (the actual fee minus the fee for the client's confirmed pricing milestone: plus means they pay more, minus means less; "on milestone" when no actual fee is set so the milestone fee is used), Eff. rate, Cost, Profit, Margin %, **Budget (this month)**, then Open and Overdue.

- **Budget (this month)** compares this calendar month's QuickBooks Time hours with the client's monthly hours budget: amber from 80%, red with **Over** at 100%. A dash means no budget is set. Bookkeepers see the same comparison as **Hours this month** on the **Clients** page. See [How do I set a monthly hours budget for a client?](#/help/hours-budget).
- **Least profitable first** sorts by margin.
- **Show clients with no activity** includes quiet clients.
- The line under the table reconciles total hours: on clients, unmapped, ignored or internal.

Click a client to see hours by QuickBooks customer and by person, hours over the period, every QuickBooks Time entry and the **Profitability** card.

### In View as (admins)

**Team** and **HR** both open in **View as**, read-only and showing what that person sees. **People** and **Performance** show their own rows; **Inventory** is read-only; **Handbook** and **Reviews** are private placeholders; **Onboarding** shows their ticks without letting you change them. See [How do I add staff and manage their access?](#/help/staff-management).

### Troubleshooting

- **No hours at all.** QuickBooks Time isn't connected, or the first sync hasn't finished (it can take about 10 minutes).
- **Hours land in "Unmapped".** A QuickBooks customer or employee isn't matched to a client or staff member yet. Use **Customer and staff mapping ›**.
- **I don't see Hours, Reply times, Feedback or Ledger review.** Those tabs are for admins. Ask an admin if you need something from them.
- **I can't find Handbook, Reviews or Onboarding on Team.** They moved to **HR** (the next place down in the left rail). **Members** moved there too, and **Employee records** is for real admins only, never a temporary admin grant. An old `#/team/...` link for any of them opens the HR page.
$q$, updated_at = now()
  where slug = 'team-page' and md5(body_md) = 'a22653b8b9b1a757eb6b3db610cd93ca';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'team-page changed since it was read (md5 mismatch)'; end if;
  if (select md5(body_md) <> 'd6041a6ee17d940c055391bf6806a851' from public.staff_guide where slug = 'team-page') then
    raise exception 'team-page: result does not match the repo file';
  end if;

  update public.staff_guide set body_md = replace(body_md, $a$### 2026-10-31: Clients can drop files anywhere$a$, $n$### 2026-10-31: Team › Hours is clearer about lag
Hours in the portal come from QuickBooks Online, which gets them from QuickBooks Time only when a pay period is approved, so the newest days can be missing. To stop that looking like zero hours: the **Capacity** card no longer has a **This week** column, its weekly average uses only the last 4 complete weeks that have fully synced, and **Avg / mo** on the Clients table uses only fully synced months. **Team › Hours** now says **Hours synced through** the newest day it has, and people paid monthly show **Paid monthly, hours post at month end**. A live connection to QuickBooks Time is not part of this. See [How do I check team capacity?](#/help/capacity).

### 2026-10-31: Clients can drop files anywhere$n$), updated_at = now()
  where slug = 'whats-new' and md5(body_md) = '74f7f829f1696773e8613b8f98d432db';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'whats-new changed since it was read (md5 mismatch)'; end if;
  if (select md5(body_md) <> 'ce4b1bb5579a19aee5e5075db850e8ad' from public.staff_guide where slug = 'whats-new') then
    raise exception 'whats-new: result does not match the repo file';
  end if;
end $$;
