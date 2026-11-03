---
title: What is MGB Home?
section: Admin
audience: admin
keywords: [mgb home, home, firm numbers, profitability, pricing and fees, overhead, internal hours, clock-in, firm books, master data sync, margin this month, internal, mgb internal, preview, cost rates, staff cost rates, needs rate, firm cost basis, full cost, staff cost, cost basis, former staff, 2027 fees, fee change review, fee increase, 2027 pricing, firm profit and loss, firm p&l, sync now, close status, capacity, utilization, target hours, ihh, contract client, allocation, allocation rules, fixed share, fallback share, pay cost]
sort: 591
---
**MGB Home** is the firm's own home: our numbers, our books and our close in one place. It is where **MGB (internal)** used to be in the left rail, and only admins the owner has given the **MGB (internal)** permission (**HR › Members**) can open it. Nobody else sees it, its pages or this article.

It is in preview. Turn it on for yourself in **Settings › Firm settings › Insight and records › Developer tools › Feature flags › MGB Home preview** (the page reloads). The owner turns it on for the firm with the owner-only switch `mgb_home_enabled` (shown read-only under **Slate switches**); then every admin with the permission gets it. Admins without the permission never see the box, the switch row or anything else about MGB Home.

### The pages

The **MGB Home** header has a thin gold line along its bottom edge and the tab row has an **Internal** lock, so a screenshot is never mistaken for a client page.

- **Home** (`#/internal`): four cards. **Margin this month** against the target (on the 1st to 3rd of a month, or while this month has no QuickBooks Time hours yet, it shows **Margin last month** with a note saying so) (once a firm cost basis is set, it shows the **Staff cost** and **Full cost** margins), **Master Data sync** (the last live sync and how many sheet rows aren't matched to a client), **Firm books** (last month's close status with its close-check badge, the first reasons it isn't ready and when it is due or late, then when QuickBooks last synced, with a warning if a sync failed, the connection needs reconnecting or it hasn't synced in over a day, and **Sync now**) and **Overhead this month** (the firm's own hours so far this month, their share of all logged hours, and their cost). Each card links to its page.
- **Profitability** (`#/internal/profitability`): **Cost basis** (**Staff cost** or **Full cost**, see below), then the clients table with fees, cost, profit and margin and the summary strip with the target margin. Click a client for its fee and profit card. Staff cost rates are on **Cost rates**. See [How do I set client fees, hourly costs and the target margin?](#/help/profitability).
- **Pricing & fees** (`#/internal/pricing`): every client's fee, where it comes from (**Master Data**, **override**, **tier default**), when it last synced, its milestone fee and the gap. Below it, the **Master Data sync** strip (Preview changes, Sync now, Details and the unmatched rows), the **2027 fee change review** (see below) and the milestone tiers for reference.
- **Overhead** (`#/internal/overhead`): the firm's own time. In QuickBooks Time that's the **My Good Books (Clock-in Option)** customer, which is mapped to **MGB (internal)** on the QuickBooks mapping page (only admins with the permission see that row or can change it). Pick a period (**This month**, **Last month**, **Last 3 months**, **This year**, **Last 12 months**). The summary shows overhead hours, their share of all logged hours, cost and people, then **By month**, **By person** (with each person's share of their own hours), **By category** and **Top descriptions**. **Download CSV** saves it. **Cost basis** works as on Profitability. Cost uses each person's loaded rate on the day (**Cost rates**). Time by a current staff member with no rate for that date, or not matched to a staff member, is costed at the average rate and marked with *. Time by someone no longer on staff is also costed at the average rate, marked with † and counted apart, not as estimated. Categories are a best guess from the service item or words in the description (Onboarding, Meetings, Training, Sales & marketing, Email & admin, Reviews & planning, Other); time with no description shows as **No description**. Internal time never counts as client hours or as unmapped hours, on Team › Hours or anywhere else.
- **Cost rates** (`#/internal/costs`): **Staff cost rates** lists every active staff member with their loaded hourly cost (pay plus taxes and benefits), the date it started and how many changes it has had. Anyone without a rate shows **needs rate** at the top; until they get one their hours are costed at the average rate and marked estimated. Click a person to add a rate with an **Effective from** date, or **Remove** one from their history. **Not on staff** lists people who are inactive in the portal or set to **ignored** in the QuickBooks Time mapping (people who have left): they need no rate, and time they logged without one is costed at the average rate as former staff. **Firm cost basis** holds two firm-wide figures per hour by effective date: the **staff rate** and the **full rate** (that plus owner pay, retirement and other overhead). Enter both and an **Effective from** date, then **Save**; history is listed with **Remove**.
- **Capacity** (`#/internal/capacity`): see **Capacity** below.
- **Firm books ▾**: the firm's own Overview, Close, Reports, Bank, Ledger review, Documents and SOP (and Finances when the plan has it). They are the same pages as before, grouped in one menu (`#/internal/books/close` and so on). **Reports** opens with **Firm Profit & Loss**: income, expenses, net income and margin for the last closed month, quarter or year to date from QuickBooks, by month, with **Download PDF**. The current month shows once it ends. The usual report downloads and the board packet are below it.
- The gear opens the firm's setup, as on any client.

### 2027 fee change review

On **Pricing & fees**, **2027 fee change review** puts each client's **Bookkeeping fee now** next to its **Bookkeeping fee 2027** from the MGB_Master_Data sheet (Clients tab). It is read only: it never changes a fee in the portal or the sheet.

1. Click **Compare now and 2027**. The portal reads the sheet (it takes a few seconds) and lists every sheet row that is matched to a client, whatever its status.
2. Each row shows **Now**, **2027**, the **Change** in dollars and the **%**. A drop shows in red.
3. **Flags**: **Moves more than 25%** (up or down), **No 2027 fee** (blank or not a number in the sheet), **No current fee**, **Lost / Paused** (status Lost, Paused or Gone), **Two sheet rows** (two rows point at the same client; the sync writes neither). Hover a blank fee to see why it was not read.
4. Use the chips (**All**, **Flagged**, **Over 25%**, **No 2027 fee**, **Lost / Paused**) to narrow the list, and click a column header to sort.
5. **Download CSV** saves what is on screen (fee now, fee 2027, change, %, flags and notes). **Read the sheet again** after you edit the sheet.

Sheet rows with no portal client are not in this list: active ones are listed to match in the **Master Data sync** strip above, and Lost, Paused or Gone ones are skipped there too. If the sheet is missing the **Bookkeeping fee now** or **Bookkeeping fee 2027** column, the review says which one and shows nothing.

### Staff cost or Full cost

**Cost basis** on Profitability and Overhead picks which cost the margins and overhead use. **Staff cost** (the default) is each person's loaded hourly cost; the target margin was set on it. **Full cost** adds the firm overhead per hour (the full rate minus the staff rate from the firm cost basis in effect on the hour's date) to each person's own rate. **Full cost** is grayed out until a firm cost basis is saved. Your choice is remembered in this browser.

### What changes on Team › Hours

With MGB Home on, **Team › Hours** shows hours only: no fees, cost, margin, summary strip, Master Data sync or cost rates. For 30 days a line there points to **MGB Home › Profitability**. Old links such as `#/team/hours?client=…` still open Hours.

The weekly digest's **Price review** and **Revenue snapshot** link to **MGB Home › Profitability**. If MGB Home isn't on for you yet, that link opens **Team › Hours**, where the money still is.

### Capacity

**Capacity** puts each person's QuickBooks Time hours next to the money: the fee revenue of the clients they work on and what their time costs. Pick a period at the top (as on Overhead); **Cost basis** works as on Profitability, and **Download CSV** saves the people and the contract split.

- The summary shows **Hours logged**, **Use of target hours** (logged hours against each person's weekly target for the days in the period; only people with a target count, and other time, such as hours by former staff or people with no target, is shown on its own line), **Fee revenue**, **Pay cost** and **Margin**.
- **Pay cost** is each person's loaded rate (**Cost rates**) × their paid hours: the target hours for the days so far, or the logged hours when they logged more. Each logged hour is priced at the rate in effect on its date, so a raise mid-month applies from its date; target hours not logged are spread evenly over the days. On **Full cost** the firm overhead per hour is added. A person with no rate is costed at the average and marked *.
- **Fee revenue** is each client's monthly fee, shared between the people who logged time on that client that month, by hours. Revenue from a client nobody logged time on that month counts in the split but isn't carried by anyone.
- **Contract clients vs MGB clients**: contract clients (such as **IHH**, Illumination Health and Home) are shown apart. Each side shows its fee revenue, the pay cost allocated to it and the margin. **MGB clients** includes the firm's own time.
- **By person**: hours, use of target, revenue carried, pay cost, each contract client's share of it, the MGB cost and the margin. *(fixed)* marks a fixed share, *(fallback)* a month with no logged hours split by the fallback share, and ‡ a month with no hours and no fallback share (counted as all MGB).

**Allocation rules** (at the bottom) decide how a person's pay cost is split:

1. **Contract clients**: pick a client and a short label, then **Add contract client**. Every other client counts as MGB.
2. **Shares by person**: pick a person, a contract client, a **Share %**, a **Kind** and an **Effective from** date, then **Save rule**. **Fixed (always)** applies every month (for someone who works only on that contract). With no fixed share, the person's cost follows the hours they logged on the contract client that month. **Fallback (months with no hours)** is used only in a month when they logged no hours at all. A newer rule takes over from its date, even mid-month; **Remove** deletes one.

If fixed and fallback shares add up to more than 100% for someone, they are scaled down and the page says so. Plain hours capacity (no money) stays on **Team › Hours** for every admin.
