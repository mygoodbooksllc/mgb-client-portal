-- Staff Handbook, part 4 seed: the Employee Handbook mockup as 9 reference
-- DRAFTS (chapters 1-9), section "Employee Handbook", order 1-9.
--
-- Run ONCE, AFTER staff-handbook-4-approvals.sql (it refuses to run before).
-- Safe to re-run: a policy whose link name already exists is left alone
-- (on conflict by slug do nothing), so edits made in the app are never
-- overwritten and nothing is created twice.
--
-- What it does, per chapter that isn't there yet:
--   * a handbook_policies row: kind 'reference', status 'draft', approval
--     'pending' (forced by the approval trigger), never published;
--   * version 1 with the chapter text (Markdown), requires_resign false;
--   * an audit row handbook.policy_created { seeded: true }.
-- And, through the approval trigger, ONE batched approver notice
-- (handbook_approval_needed to the policy approver) for all nine drafts. If
-- an unsent notice is already waiting, none is added.
--
-- What it never does: publish, convert to signed, create a signature, or
-- queue any other email. Drafts are visible to admins only.
--
-- Source: the "MGB Employee Handbook" mockup artifact (Draft 1, October
-- 2026), chapters 1-9, wording unchanged. Placeholders highlighted in the
-- mockup are written **[TBD: ...]** so they stand out and can be edited in
-- the app (Edit text). Links (the Team Onedoc, the org chart) are Markdown
-- links. The cover, contents, running heads and page numbers are left out.
-- Chapter 10 (Acknowledgment, a sign-here page) is NOT loaded: signing in the
-- portal replaces it, and a policy only asks for signatures after an admin
-- uses Make this a signed policy.

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'handbook_policies'
                   and column_name = 'approval_status')
     or to_regprocedure('public.hb_queue_approval_notice()') is null then
    raise exception 'Run supabase/staff-handbook-4-approvals.sql before this seed.';
  end if;
end $$;

create temp table _hb_seed (n int primary key, slug text not null, title text not null, body text not null)
  on commit drop;

insert into _hb_seed (n, slug, title, body) values
  (1, 'employee-handbook-welcome', 'Welcome to MyGoodBooks',
$hb_body$*Why we're here, and who we serve.*

## 1.1 Our story

Jeff and Bailley Hawkins started MyGoodBooks in 2017. They saw churches doing important work while their books fell behind, and they wanted to take that weight off pastors and finance teams. Today we keep the books for more than 50 churches across the country, along with nonprofits and a few small businesses.

## 1.2 Why we exist

> Delivering bookkeeping solutions to our clients, and flexible work to our employees.

Both halves matter. We protect our clients' time and money, and we protect yours. Flexible work is part of the deal, not a perk we hand out.

## 1.3 Who our clients are

Most of our clients are churches. Their money is given money: tithes, offerings and gifts from people who trust that it will be handled well. We treat every dollar that way. Our clients are pastors, treasurers, executive directors and volunteer finance teams. Many of them are not accountants, so part of our job is to make their numbers make sense.

## 1.4 How to use this handbook

- This handbook covers the policies that rarely change: employment, pay, time off, security and conduct.
- The things that change often (priorities, roles, who owns what) live in the **Team Onedoc**. Chapter 3 explains how the two fit together.
- Questions about anything here go to Holden (COO). Questions about client work go to Jesse first.
- If this handbook and a written agreement with you ever disagree, the agreement wins.
$hb_body$),
  (2, 'employee-handbook-employment-basics', 'Employment Basics',
$hb_body$*The ground rules of working here.*

## 2.1 Equal opportunity

MyGoodBooks hires, pays, trains and promotes people based on their work and their fit for the role. We do not discriminate on any basis protected by federal, South Carolina or local law. **[TBD: Legal review: faith-based firm language, if any]**

## 2.2 At-will employment

Employment with MyGoodBooks is at will. You or the company may end it at any time, with or without notice. Nothing in this handbook is a contract or a promise of employment for any length of time.

## 2.3 Job classifications

| Classification | What it means |
| --- | --- |
| Full-time | Regularly scheduled 40 hours a week |
| Part-time | Fewer hours, often set by your client load and allowable hours |
| Contractor | Works under a separate agreement. Most of this handbook does not apply. |
| Exempt / non-exempt | Set by federal wage law. Your offer letter tells you which you are. |

## 2.4 Your first 90 days

Holden runs employee onboarding: your accounts, equipment and paperwork. If you're a bookkeeper, Jesse runs your training and assigns your first clients. The first 90 days are an introductory period for both of us. We'll check in at 30, 60 and 90 days. **[TBD: confirm check-in schedule]**

## 2.5 Background checks

Because we handle church and nonprofit funds, roles with access to client accounts **[TBD: may require a background check before starting]**.
$hb_body$),
  (3, 'employee-handbook-how-we-work', 'How We Work',
$hb_body$*This chapter stays short on purpose.*

## 3.1 The Team Onedoc

Who owns what at MyGoodBooks changes as we grow. A printed handbook can't keep up, so the current version lives in one place: the Team Onedoc. Read it in your first week and come back whenever you aren't sure who to ask.

*Always current*

#### MyGoodBooks Team Onedoc

- Why we exist and what we do
- Our three values, in detail
- What's most important right now
- Who must do what
- Who to ask, and who they report to
- Everyday templates and resources
- Where our clients are

[Open the Onedoc](https://docs.google.com/document/d/1PLbzOgRTiNjIzl-FwBL-2ODiMJHGyrYCfnfdKvBfXak/edit) · [Interactive org chart](https://claude.ai/artifact/UtV9p3xP5aWKPcstQ9GdZA)

> **When they disagree:** For who owns what, the Onedoc wins, because it's the one we keep current. For policy (pay, time off, conduct), this handbook wins. The Co-CEOs own the Onedoc, and the COO updates it whenever the team changes.

## 3.2 Our values

Our three values are **Camaraderie**, **Ownership** and **Healthy Hustle**. The Onedoc spells out how each one shows up day to day. They don't change often, and they are what we hire for, train for and review against.

## 3.3 How client work moves

1. **Onboard:** The COO brings the client on.
2. **Assign:** The Account Manager picks the bookkeeper.
3. **Monthly work:** The bookkeeper owns the client month to month.
4. **Review:** An admin reviews the work.

Roles, not names, because the names change. The Onedoc says who holds each role today.

## 3.4 Where questions go

- **Client work, hours or a stuck task:** the Account Manager first.
- **Equipment, accounts, IT or hiring:** the COO.
- **Payroll or HR:** see the Onedoc. These are moving from Bailley to Holden during the 2026 transition.
$hb_body$),
  (4, 'employee-handbook-client-work-standards', 'Client Work Standards',
$hb_body$*What good work looks like here.*

## 4.1 One bookkeeper per client

Every client has one assigned bookkeeper who owns their monthly work. You know their accounts, their people and their calendar. When you're out, the Account Manager arranges coverage, and the covering bookkeeper gets access only for as long as it's needed.

## 4.2 The monthly cycle: 4 · 14 · 24

Each month has three checkpoints. Monthly tasks are due on these calendar days. The Bookkeeper 4 · 14 · 24 template lists what belongs to each one.

- **4th:** First checkpoint
- **14th:** Second checkpoint
- **24th:** Third checkpoint

**[TBD: Add a one-line summary of what's due at each checkpoint]**

## 4.3 Review

When your work is ready, mark it ready for review. Any admin can approve it or send it back with a reason. The Account Manager is the default reviewer. Bookkeepers don't review each other's work. Sent-back work isn't a mark against you; it's how we keep every client's books right.

## 4.4 How we talk to clients

- Warm and plain. No jargon. If a pastor wouldn't say it, explain it.
- Stewardship, never sales. We help clients care for what they've been given.
- Don't promise a date for reports, the monthly close or a review. Tell the client when you expect them, and keep them posted.
- Our promise is about price: *"Your price in writing before you commit. It only changes when your milestone does."* Pricing and milestone questions go to the COO.
- Call the main portal view the **Financial Overview**.

## 4.5 When something goes wrong

Mistakes happen. Hidden mistakes are the problem. If you find an error in a client's books, yours or anyone's, tell the Account Manager the same day. We fix it, tell the client if it affects them, and move on.
$hb_body$),
  (5, 'employee-handbook-hours-pay', 'Hours, Pay & Allowable Hours',
$hb_body$*Flexible work, with a budget for every client.*

## 5.1 Flexible work

Most of us work remotely and set our own hours around our clients' checkpoints. Flexibility comes with ownership: deadlines are met, clients hear back within **[TBD: one business day?]**, and you're reachable during **[TBD: core hours, if any]**. The Ideal Work Week guide shows how to shape a balanced week.

## 5.2 Allowable hours per client

Every client has a set number of allowable hours a month, based on their pricing milestone. They're listed in the Allowable Hours sheet. Managing them well is what Healthy Hustle means in practice.

- Track your time against each client **[TBD: in which tool?]**
- If a client will go over, tell the Account Manager before it happens, not after.
- A client who keeps going over may need a new milestone. That's a conversation for the COO, not a reason to work unpaid.

## 5.3 Payroll

We run payroll through Gusto. You'll get access to it during onboarding to see pay stubs, tax forms and your direct deposit.

- **Pay schedule:** **[TBD: Semi-monthly? Paydays?]**
- **Time entry due:** **[TBD: confirm]**
- **Overtime:** Non-exempt employees need approval before working overtime, and are paid for all overtime worked.
- **Payroll questions:** See the Onedoc (moving from Bailley to Holden)

## 5.4 Expenses

**[TBD: Reimbursement policy: home office, internet, software, mileage]**
$hb_body$),
  (6, 'employee-handbook-time-off', 'Time Off & Holidays',
$hb_body$*Rest is part of Healthy Hustle.*

## 6.1 Paid time off

Full-time employees earn **[TBD: X days]** of paid time off a year. Part-time employees **[TBD: earn PTO pro rata / don't earn PTO]**.

## 6.2 Asking for time off

- Ask **[TBD: two weeks]** ahead, and avoid your clients' checkpoint days when you can.
- Tell the Account Manager which clients need coverage while you're out.
- For sick days, let the Account Manager know as soon as you can, the same day.

## 6.3 Company holidays

**[TBD: List holidays: New Year's Day, Easter Monday?, Memorial Day, Independence Day, Labor Day, Thanksgiving, Christmas…]**

> **Church calendars:** Christmas and Easter are our clients' busiest weeks. Plan around them, and expect more questions than usual in the weeks before.

## 6.4 Other leave

Jury duty, voting, military and other leave follow federal and South Carolina law. **[TBD: Parental and bereavement leave policy]**
$hb_body$),
  (7, 'employee-handbook-tools-security', 'Tools, Security & Client Data',
$hb_body$*Our clients trust us with their giving records. We guard them.*

## 7.1 The tools we use

| Tool | What it's for |
| --- | --- |
| QuickBooks Online | Client books |
| MyGoodBooks portal | Client reports, documents and messages at app.mygoodbooks.org. Clients sign in with an emailed link. |
| Tasks | Asana today. Moving to Tasks inside the portal, planned for late 2026. |
| Google Workspace | Your @mygoodbooks.org email, Drive and the Onedoc |
| Gusto | Payroll for MyGoodBooks and for clients who use it |

## 7.2 Accounts and equipment

The COO sets up your accounts and tracks company equipment. Use your @mygoodbooks.org account for all client work. When you leave, all equipment and access are returned on your last day.

## 7.3 Protecting client data

- Turn on two-step verification for every work account.
- Never share passwords, even with teammates. Ask the COO for access instead.
- Keep client files in company Drive or the portal, never on personal accounts or USB drives.
- Donor and giving records are private. Never discuss what a member gives, even with church staff who don't need to know.
- Lock your screen when you step away, and don't work on client books on public Wi-Fi without **[TBD: a VPN?]**
- Report a lost device or a suspicious email to the COO right away.
$hb_body$),
  (8, 'employee-handbook-growth-reviews', 'Growth & Reviews',
$hb_body$*Support, encourage, and challenge.*

## 8.1 Training

The Account Manager trains every bookkeeper: our checkpoints, our review standards and each client's quirks. Training doesn't stop after onboarding. When you take on a new client, you're trained on that client before your first month.

## 8.2 Quarterly reviews

Every quarter you'll sit down with the Account Manager using the Quarterly Review Template. We look at:

- How your work held up in review
- How you managed allowable hours across your clients
- How you lived out Camaraderie, Ownership and Healthy Hustle
- What you want to learn or take on next

## 8.3 Feedback goes both ways

Tell us what's not working: a client, a tool, your load. Start with the Account Manager. If it's about the Account Manager, go to the COO.

## 8.4 Pay reviews

**[TBD: When and how pay is reviewed]**
$hb_body$),
  (9, 'employee-handbook-conduct', 'Conduct & Confidentiality',
$hb_body$*How we treat each other, and the people we serve.*

## 9.1 Respect

We don't tolerate harassment or discrimination of any kind, from anyone: staff, clients or vendors. If it happens to you or you see it, tell the COO or either Co-CEO. You will not be punished for reporting in good faith.

## 9.2 Confidentiality

Everything you learn about a client stays with MyGoodBooks: finances, giving, staff pay and church matters. This continues after you leave. Don't name clients on social media or in public without their permission.

## 9.3 Handling client money

- Never move client money without written approval from the client.
- Never pay yourself or a relative from a client account.
- Disclose any personal tie to a client, like membership or family, to the COO.

## 9.4 When something's wrong

If you suspect fraud, misuse of funds or anything that doesn't sit right in a client's books, tell the COO or a Co-CEO. You will not be punished for raising a concern in good faith. **[TBD: Discipline steps, if any]**
$hb_body$);

do $$
declare
  r record;
  v_id uuid;
  v_made int := 0;
  v_skipped int := 0;
  v_before int;
  v_after int;
begin
  select count(*) into v_before from notification_outbox where kind = 'handbook_approval_needed';
  for r in select * from _hb_seed order by n loop
    v_id := null;
    insert into handbook_policies (slug, title, sort, kind, status, section, published_at)
    values (r.slug, r.title, r.n, 'reference', 'draft', 'Employee Handbook', null)
    on conflict (slug) do nothing
    returning id into v_id;
    if v_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into handbook_versions (policy_id, version_no, body_md, body_sha256, requires_resign, change_note, published_by)
    values (v_id, 1, r.body, encode(sha256(convert_to(r.body, 'UTF8')), 'hex'), false,
            'First draft, from the Employee Handbook mockup.', 'system');
    perform audit_write('handbook.policy_created', null, 'handbook_policy', v_id::text,
      jsonb_build_object('policy', r.slug, 'title', r.title, 'kind', 'reference',
                         'section', 'Employee Handbook', 'seeded', true));
    v_made := v_made + 1;
  end loop;
  select count(*) into v_after from notification_outbox where kind = 'handbook_approval_needed';
  raise notice 'Employee Handbook seed: % drafts created, % already there, % approver notice(s) queued.',
    v_made, v_skipped, v_after - v_before;
  if v_made > 0 and (hb_approver()).id is null then
    raise notice 'No approver notice: the policy approver is not an active admin. Set one in Team > Handbook.';
  end if;
end $$;

commit;
