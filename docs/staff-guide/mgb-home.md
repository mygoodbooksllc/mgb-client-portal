---
title: What is MGB Home?
section: Admin
audience: admin
keywords: [mgb home, home, firm numbers, profitability, pricing and fees, firm books, master data sync, margin this month, internal, mgb internal, preview, cost rates, staff cost rates]
sort: 591
---
**MGB Home** is the firm's own home: our numbers, our books and our close in one place. It is where **MGB (internal)** used to be in the left rail, and only admins the owner has given the **MGB (internal)** permission (**HR › Members**) can open it. Nobody else sees it, its pages or this article.

It is in preview. Turn it on for yourself in **Settings › Firm settings › Insight and records › Developer tools › Feature flags › MGB Home preview** (the page reloads). The owner turns it on for the firm with the owner-only switch `mgb_home_enabled` (shown read-only under **Slate switches**); then every admin with the permission gets it. Admins without the permission never see the box, the switch row or anything else about MGB Home.

### The pages

The **MGB Home** header has a thin gold line along its bottom edge and the tab row has an **Internal** lock, so a screenshot is never mistaken for a client page.

- **Home** (`#/internal`): three cards. **Margin this month** against the target, **Master Data sync** (the last live sync and how many sheet rows aren't matched to a client), and **Firm books** (last month's close status and when QuickBooks last synced). Each card links to its page.
- **Profitability** (`#/internal/profitability`): the clients table with fees, cost, profit and margin, the summary strip with the target margin, and **Staff cost rates**. Click a client for its fee and profit card, or a person for their loaded hourly cost. See [How do I set client fees, hourly costs and the target margin?](#/help/profitability).
- **Pricing & fees** (`#/internal/pricing`): every client's fee, where it comes from (**Master Data**, **override**, **tier default**), when it last synced, its milestone fee and the gap. Below it, the **Master Data sync** strip (Preview changes, Sync now, Details and the unmatched rows) and the milestone tiers for reference.
- **Firm books ▾**: the firm's own Overview, Close, Reports, Bank, Ledger review, Documents and SOP (and Finances when the plan has it). They are the same pages as before, grouped in one menu (`#/internal/books/close` and so on).
- The gear opens the firm's setup, as on any client.

### What changes on Team › Hours

With MGB Home on, **Team › Hours** shows hours only: no fees, cost, margin, summary strip, Master Data sync or cost rates. For 30 days a line there points to **MGB Home › Profitability**. Old links such as `#/team/hours?client=…` still open Hours.

The weekly digest's **Price review** and **Revenue snapshot** link to **MGB Home › Profitability**. If MGB Home isn't on for you yet, that link opens **Team › Hours**, where the money still is.

### Not here yet

Overhead (internal hours), Cost rates as its own page and Capacity come in later updates.
