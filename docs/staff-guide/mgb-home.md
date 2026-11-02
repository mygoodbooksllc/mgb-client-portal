---
title: What is MGB Home?
section: Admin
audience: admin
keywords: [mgb home, home, firm numbers, profitability, pricing and fees, overhead, internal hours, clock-in, firm books, master data sync, margin this month, internal, mgb internal, preview, cost rates, staff cost rates, needs rate, firm cost basis, full cost, staff cost, cost basis, former staff]
sort: 591
---
**MGB Home** is the firm's own home: our numbers, our books and our close in one place. It is where **MGB (internal)** used to be in the left rail, and only admins the owner has given the **MGB (internal)** permission (**HR › Members**) can open it. Nobody else sees it, its pages or this article.

It is in preview. Turn it on for yourself in **Settings › Firm settings › Insight and records › Developer tools › Feature flags › MGB Home preview** (the page reloads). The owner turns it on for the firm with the owner-only switch `mgb_home_enabled` (shown read-only under **Slate switches**); then every admin with the permission gets it. Admins without the permission never see the box, the switch row or anything else about MGB Home.

### The pages

The **MGB Home** header has a thin gold line along its bottom edge and the tab row has an **Internal** lock, so a screenshot is never mistaken for a client page.

- **Home** (`#/internal`): four cards. **Margin this month** against the target (once a firm cost basis is set, it shows the **Staff cost** and **Full cost** margins), **Master Data sync** (the last live sync and how many sheet rows aren't matched to a client), **Firm books** (last month's close status and when QuickBooks last synced) and **Overhead this month** (the firm's own hours so far this month, their share of all logged hours, and their cost). Each card links to its page.
- **Profitability** (`#/internal/profitability`): **Cost basis** (**Staff cost** or **Full cost**, see below), then the clients table with fees, cost, profit and margin and the summary strip with the target margin. Click a client for its fee and profit card. Staff cost rates are on **Cost rates**. See [How do I set client fees, hourly costs and the target margin?](#/help/profitability).
- **Pricing & fees** (`#/internal/pricing`): every client's fee, where it comes from (**Master Data**, **override**, **tier default**), when it last synced, its milestone fee and the gap. Below it, the **Master Data sync** strip (Preview changes, Sync now, Details and the unmatched rows) and the milestone tiers for reference.
- **Overhead** (`#/internal/overhead`): the firm's own time. In QuickBooks Time that's the **My Good Books (Clock-in Option)** customer, which is mapped to **MGB (internal)** on the QuickBooks mapping page (only admins with the permission see that row or can change it). Pick a period (**This month**, **Last month**, **Last 3 months**, **This year**, **Last 12 months**). The summary shows overhead hours, their share of all logged hours, cost and people, then **By month**, **By person** (with each person's share of their own hours), **By category** and **Top descriptions**. **Download CSV** saves it. **Cost basis** works as on Profitability. Cost uses each person's loaded rate on the day (**Cost rates**). Time by a current staff member with no rate for that date, or not matched to a staff member, is costed at the average rate and marked with *. Time by someone no longer on staff is also costed at the average rate, marked with † and counted apart, not as estimated. Categories are a best guess from the service item or words in the description (Onboarding, Meetings, Training, Sales & marketing, Email & admin, Reviews & planning, Other); time with no description shows as **No description**. Internal time never counts as client hours or as unmapped hours, on Team › Hours or anywhere else.
- **Cost rates** (`#/internal/costs`): **Staff cost rates** lists every active staff member with their loaded hourly cost (pay plus taxes and benefits), the date it started and how many changes it has had. Anyone without a rate shows **needs rate** at the top; until they get one their hours are costed at the average rate and marked estimated. Click a person to add a rate with an **Effective from** date, or **Remove** one from their history. **Not on staff** lists people who are inactive in the portal or set to **ignored** in the QuickBooks Time mapping (people who have left): they need no rate, and time they logged without one is costed at the average rate as former staff. **Firm cost basis** holds two firm-wide figures per hour by effective date: the **staff rate** and the **full rate** (that plus owner pay, retirement and other overhead). Enter both and an **Effective from** date, then **Save**; history is listed with **Remove**.
- **Firm books ▾**: the firm's own Overview, Close, Reports, Bank, Ledger review, Documents and SOP (and Finances when the plan has it). They are the same pages as before, grouped in one menu (`#/internal/books/close` and so on).
- The gear opens the firm's setup, as on any client.

### Staff cost or Full cost

**Cost basis** on Profitability and Overhead picks which cost the margins and overhead use. **Staff cost** (the default) is each person's loaded hourly cost; the target margin was set on it. **Full cost** adds the firm overhead per hour (the full rate minus the staff rate from the firm cost basis in effect on the hour's date) to each person's own rate. **Full cost** is grayed out until a firm cost basis is saved. Your choice is remembered in this browser.

### What changes on Team › Hours

With MGB Home on, **Team › Hours** shows hours only: no fees, cost, margin, summary strip, Master Data sync or cost rates. For 30 days a line there points to **MGB Home › Profitability**. Old links such as `#/team/hours?client=…` still open Hours.

The weekly digest's **Price review** and **Revenue snapshot** link to **MGB Home › Profitability**. If MGB Home isn't on for you yet, that link opens **Team › Hours**, where the money still is.

### Not here yet

Capacity comes in a later update.
