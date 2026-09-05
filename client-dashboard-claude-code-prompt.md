# Project Brief for Claude Code: Bookkeeping Client Dashboard App

## Context
I run a bookkeeping business. I want to build a desktop-style app that my clients can open to see their financial data at a glance — QuickBooks numbers and bank account data, similar in spirit to budgeting/reporting tools like Martus Solutions, but simpler and branded as my own product. I am not a developer, so I need you to make reasonable technical decisions on my behalf and explain them in plain language as you go.

This is a multi-phase build. **For this session, only build Phase 1.** Do not set up real QuickBooks or bank integrations yet — I want to see and react to the interface first with fake data before we connect anything real.

## Phase 1 — Prototype (this session)
Build a web app (not yet a desktop app) using React, with entirely mock/hardcoded data. No real accounts, no APIs, no auth yet.

**Sample data:** Create 3–4 fake sample clients (small businesses), each with a few months of made-up financials — income, expenses, a couple of budget categories, and a mock bank balance with a handful of recent transactions.

**Screens to build:**
1. **Client switcher** — a simple way to pick which client's data is being viewed (since I serve multiple clients, but each client should only ever see their own).
2. **Dashboard / overview** — cash on hand, income vs. expenses for the current month, a couple of KPI cards (e.g., net income, cash runway), and a simple chart.
3. **Budget vs. actual view** — a table or chart comparing budgeted amounts to actual spending by category.
4. **Bank view** — current balance and a list of recent transactions.

**Design:** Clean, modern, trustworthy — this is financial software for small business owners, not a toy. Use your own layout and visual style; don't copy any specific existing product's branding or exact UI.

**Goal of this phase:** I want something I can click through and react to — what's useful, what's missing, what layout doesn't work — before any real data or integration work happens.

---

## Full Roadmap (for your awareness — do not build beyond Phase 1 yet)

**Phase 2 — Real QuickBooks data**
Replace mock data with live QuickBooks data via QuickBooks' official OAuth API (read-only scopes). Pull P&L, balance sheet, and budget data if available. Requires me to register a QuickBooks developer app.

**Phase 3 — Bank data**
Connect real bank data, most likely via Plaid or a similar aggregator. Note this typically has a per-connection cost once live with real clients. Decide whether bank data updates live or is synced periodically.

**Phase 4 — Package as a desktop app**
Wrap the working web app using something like Tauri or Electron so clients can open it as a native-feeling desktop application ("dock app") rather than a browser tab.

**Phase 5 — Client access & security**
Add proper per-client authentication so each client can only ever access their own data. This needs to be solid before any real client financial data is involved — flag any security shortcuts you're taking along the way so I know what needs to be hardened before going live.

---

## How to work with me
- I'm not a developer — explain technical decisions in plain language, not jargon.
- Ask me before making big architecture calls, but otherwise use good default judgment to keep moving.
- At the end of this session, tell me clearly what's mock/fake vs. what would need real setup (API keys, accounts, etc.) before Phase 2.
