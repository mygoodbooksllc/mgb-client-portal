# MGB Home (spec, 2026-10-31)

Status: SPEC ONLY, nothing built. Owner decisions needed: see Open questions at the end.
Size: **Big** (money, permissions, routing, a hidden preview). Opus specs, builds money/permission slices, critiques and verifies; Sonnet builds UI-only slices; Haiku runs screenshot and grep sweeps.

## 1. Goal and non-goals

**Goal.** Turn MGB (internal) from "a client page that happens to be ours" into **MGB Home**: the firm's own control room, visibly different from a client page, holding every firm-level money view in one place. Team › Hours becomes hours-only, with no money for anyone.

**Non-goals**
- No new permission. Access stays the existing MGB (internal) grant (`can_view_internal()`).
- No write-back to QuickBooks or to the MGB_Master_Data sheet.
- No change to how real clients look or to what bookkeepers see.
- No quote tool UI (still only `quote_inputs()` server-side; separate project).
- No QuickBooks Time live API (parked, see memory `project-qb-time-api`).

## 2. What exists today

### The internal client
- Row `clients.id = 'mygoodbooks'` ("MyGoodBooks", plan premium), `clients.is_internal = true`. One internal row max (`clients_one_internal`). `supabase/internal-company-profile.sql`.
- **Who sees it.** `can_view_internal()` = active staff admin AND a row in `internal_access`. Live rows: holden (owner), bailley, jeff, admin@. Jesse is an active admin with **no** row. Only the owner changes rows (`set_internal_access`, HR › Members column). Demotion/deactivation removes the row (trigger `internal_access_staff_sync`).
- **The lock.** Every table with `client_id` has the RESTRICTIVE "internal company lock" policy (`internal_blocked_ids()`); `can_access_client()` refuses the internal id without the grant; Storage folder too. `is_roster_client()` / `is_roster_client_id()` keep it out of every firm-wide rollup. `supabase/internal-company-profile-tests.sql` fails if a new `client_id` table lacks the lock.
- **Front end.** `components/auth/AuthGate.jsx` loads `staffUser.canViewInternal` / `isInternalOwner`. `app.jsx`: `STAFF_canViewInternal(realUser, impersonating)` (admin + grant + not in View as), `STAFF_internalClient()`, `openInternal()`, hash `#/internal` → bare `#/client/mygoodbooks/...`. `index.html`: `window.mgbIsInternalClient`, `isInternal` on CLIENTS. Rail item: `NAV_PLACES` key `internal` in `components/staff/StaffNav.jsx` ("MGB (internal)", visible `ctx.canViewInternal && !ctx.impersonating`). Badge `cs-internal-badge` in `ClientSwitcher.jsx`; `ClientFlags.jsx` tags it.
- **Tabs it shares with clients.** The full staff client row `STAFF_CLIENT_TABS` (app.jsx ~1569): Overview, Messages, Documents, Bank, Close, Ledger review, Reports, SOP, Milestone (admin); plus Client view pages (`dashboard`, `budget`, `receivables`, `giving`, `payroll`) and Client setup. Nothing differs except the badge.
- **Usage.** Last 30 days of internal page views: holden 163, jeff 7.

### QuickBooks for the internal client
- `qbo_connections` row for `mygoodbooks`: realm `193514537186744`, production, connected 2026-10-14. 12 months of `qbo_monthly_pl`, 13 `month_close` rows (latest period 2026-08).
- **Same realm as the firm QuickBooks Time connection** (`qbo_firm_connection`, separate token set in `qbo_firm_tokens`).
- **Broken right now.** Since 2026-10-31 09:12 UTC every 5-minute sync of `mygoodbooks` fails: `TransactionList report failed (400)` (126 errors in `qbo_sync_errors` so far, also burning API calls). Must be fixed before Firm books ships (slice S0).

### Team › Hours today (`#/team/hours`, admin tab incl. temporary admins)
`components/staff/TeamPage.jsx` (`TP_TeamPage`), `TeamQbo.jsx`, `TeamProfit.jsx`, `TeamCapacity.jsx`, `HoursBudget.jsx`, `QboUsage.jsx`.
- No money: QuickBooks Time panel + mapping (`TP_QboPanel`, `TP_QboMapping`), API usage card (`QU_UsageCard`), Capacity card, People table, Clients table hours / avg / budget / trend, drill-downs, "Hours synced through".
- Money, already gated by `TP_PF_canSee(user)` (admin + `canViewInternal`): `TP_PF_SummaryStrip` (incl. target margin editor), `TP_PF_SheetSyncStrip` (Master Data sync, Details, unmatched rows), Clients table columns Fee / Milestone gap / Rate / Cost / Profit / Margin, CSV money columns, client drill "Fee / mo" + "Effective rate" stats and `TP_PF_ClientProfitCard` (fee editor, override, cost by staffer), person drill `TP_PF_RateCard` (loaded hourly cost editor).
- Money **not** gated (any admin, Jesse included): **Billable value** column on Clients table, bucket rows, totals stat, CSV, and per-entry `hourly_rate` in `TP_QboDrill`. Server: `qbo_hours_by_client()` returns `billable_value` to any admin; `qbo_time_activities.hourly_rate` is readable by any admin. All 10,268 synced entries have no rate today, so it shows "–", but it is still a money surface.
- Users (30 days, tab = hours): holden 40, jesse 4, jeff 1.
- Inbound links: Overview "Hourly rate · this month" card (`#/team/hours?client=<id>`, `LK_useArrival`), `SS_alerts.js` usage alert, `TopBar.jsx` throttle pill, Settings.jsx "QuickBooks usage and limits", weekly-admin-digest Price review / Revenue snapshot links (`#/team/hours`), Tour.jsx admin steps `team("hours")` and `profit`, `DeepLink.jsx` `LK_PLACE_CLAIMS["team/hours"]`.

### Money data (all gated admin + `can_view_internal()`)
`client_fees` (+ `source`, `sheet_override`, `synced_at`), `staff_cost_rates` (6 people, per-person loaded rate by date; no firm-level rate), `profitability_settings` (target 40%), `client_profitability()`, `quote_inputs()`, `saved_quotes`, `master_sheet_client_map` / `_sync_runs` / `_unmatched` (10 unmatched now), audit rows `client_fee.*`, `cost_rate.*`, `profitability.*`, guide article `profitability` (RESTRICTIVE policy on `staff_guide`, slug list of one). Edge function `master-sheet-sync` checks `can_view_internal()` as the caller; `FEE_COLUMN = "2027"`. Milestone tiers: `client_milestones` (staff with client access; tiers are public pricing).

### Hours that vanish today
Since 2026-07-01: 1,501 h mapped to clients, **973 h unmapped**, of which **781 h** is QuickBooks customer "My Good Books (Clock-in Option)" (8 people, 64 distinct descriptions). Mapping a customer to the internal client is allowed only with the grant (`qbo_set_customer_mapping`); once mapped, `qbo_hours_by_client` drops it and `qbo_hours_by_staff` counts it as ignored. No RPC reports internal hours.

### Preview pattern and upkeep rules
- Preview: localStorage flag in `FEATURE_FLAGS` (app.jsx ~1000, e.g. `mgb_clientdrop_preview`) + owner-only `tk_settings` switch listed in `tk__owner_only_key()` (latest: `supabase/owner-only-threadmenu-switch.sql`) + one gate file (`CPD_gate.js`, `TM_gate.js`). Code never writes the switch.
- `tk_settings` is readable by every active staff member; Developer tools (flags + settings descriptions) is visible to every admin, Jesse included.
- `usage_events` rows with `client_id = 'mygoodbooks'` are hidden from non-grant admins by the internal lock; rows with `client_id` null are not.
- `whats-new.md` is audience `staff` (everyone reads it). Announcements support `visible(ctx)` that hides an entry everywhere (`components/tour/announcements.js`).

## 3. Information architecture and layout

**Rail:** the `internal` place is relabelled **MGB Home** (hint "The firm's own numbers, books and close") when the MGB Home gate is on; otherwise unchanged.

**MGB Home is still the internal client**, so every page logs `client_id = 'mygoodbooks'` and inherits the lock. It replaces the client tab row with its own row:

| Tab | Route | Slice |
|---|---|---|
| Home (landing) | `#/internal` | S1 |
| Profitability | `#/internal/profitability` | S1 |
| Pricing & fees | `#/internal/pricing` | S1 (fee review S5) |
| Firm books ▾ (Overview, Close, Reports, Bank, Ledger review, Documents, SOP, Finances) | `#/internal/books/<tab>` → existing page keys | S1 (regroup only) |
| Overhead | `#/internal/overhead` | S2 |
| Cost rates | `#/internal/costs` | S3 |
| Capacity | `#/internal/capacity` | S6 (pending OQ7) |

Dropped for the internal client: Messages (no client users), Milestone (pricing for ourselves is meaningless), Client view menu, health dot, plan pill. Client setup stays behind the gear (QuickBooks connection lives there).

**What makes it look different** (follow `feedback-visual-direction`: surface top bar `.app-topbar`, `--topbar-bg`, tabs on the surface):
- Header reads **MGB Home** with the logo mark, not a client tile with initials; subtitle "MyGoodBooks · internal, admins with access only".
- A thin brand-color rule under the top bar and a lock glyph on the tab row, so a screenshot is never mistaken for a client page.
- Home is a firm dashboard: 4 cards (Margin this month vs target; Overhead hours this month; Master Data sync state + unmatched count; Firm books close status + last QuickBooks sync), each linking to its tab.
- No new colors outside design-system tokens; dark mode via existing tokens.

## 4. Per-tab scope

All tabs: mounted only when `MH_canOpen()` (section 6). Every query below is already, or will be, refused server-side without `can_view_internal()`.

**Home.** Reads `client_profitability()` (current month), `master_sheet_sync_runs` latest + `count(master_sheet_unmatched)`, `month_close` for `mygoodbooks`, `qbo_connections` status, S2 overhead RPC. No writes.

**Profitability (moved from Hours).** `TP_PF_SummaryStrip` (target editor), a Clients table with Fee / Milestone gap / Rate / Cost / Profit / Margin + hours, period picker, CSV; click a client → `TP_PF_ClientProfitCard` (fee editor, override, cost by staffer). Reuses `TP_PF_useProfit` and `TP_useQboHours` (hours are not secret). Data: `client_profitability()`, `client_fees`, `profitability_settings`, `qbo_hours_by_client()`.

**Pricing & fees.** Fee list (every roster client: fee, source tag, override, synced at, tier fee, gap); `TP_PF_SheetSyncStrip` (Preview / Sync now / Details / unmatched rows with Match to client / Not a client), milestone tiers reference (`milestoneByTier`, read-only). S5 adds **2027 fee change review**: a new read-only `compare` action on `master-sheet-sync` returns both `Bookkeeping fee now` and `Bookkeeping fee 2027` per matched client; the tab shows now → 2027, $ and % change, flags (>25% move, missing 2027 fee, Lost/Paused), CSV. No writes; the live `sync` path is unchanged.

**Cost rates.** (S1 interim: Profitability lists "Staff cost rates" and opens `TP_PF_RateCard`, because Hours drops money; S3 moves that list here rather than duplicating it.) Moves `TP_PF_RateCard` here as a people list (current rate, effective from, history). Adds a firm cost basis: new table `firm_cost_basis(effective_from date pk, staff_rate numeric, full_rate numeric, note, updated_by, updated_at)` holding the owner's two blended figures (staff cost per hour vs full cost including owner pay and retirement; values live only in the database, never in code or docs). Profitability gains a "Cost basis: Staff rates / Full cost" toggle (OQ4). New RPC param `client_profitability(..., p_basis text default 'staff')` or a sibling RPC; either refuses without the grant.

**Overhead.** Owner maps "My Good Books (Clock-in Option)" (and any other internal QuickBooks customers) to MGB (internal) in the existing mapping page. New RPC `internal_hours(p_from, p_to)` SECURITY DEFINER, refuses without `can_view_internal()`: per person and per description/item, minutes on customers resolved to the internal client, plus each person's share of their total hours. Cost at loaded rate (or full cost per OQ4). Shows trend by month and the top descriptions so admin, training and sales time is visible instead of "Unmapped".

**Firm books.** Regroups the internal client's existing pages under one menu, unchanged components: Overview, Close (`month_close`, close checks), Reports (P&L, Balance Sheet from `qbo_*`), Bank, Ledger review, Documents, SOP, and Finances (`dashboard`, `budget`, `receivables`). No new data. Blocked on S0 for fresh numbers.

**Capacity (later).** Hours per person (`qbo_hours_by_staff`, `staff_capacity`) next to the fee revenue of the clients they carry and their cost, plus allocation rules for people whose cost sits on another client (OQ7). Plain hours capacity stays on Team › Hours for every admin.

## 5. What moves out of Hours, and links

Team › Hours after S1 (every admin, incl. temporary admins, Jesse): QuickBooks Time panel, mapping, API usage, Capacity, People, Clients (hours, avg, budget, trend, tasks). **Removed for everyone:** every `TP_PF_*` mount, Billable value (column, bucket cells, totals stat, CSV), drill `hourly_rate` column. Server: patch live `qbo_hours_by_client()` to return `billable_value = null` unless `can_view_internal()` (pg_get_functiondef + anchored replace, as `internal-company-profile.sql` does). `qbo_time_activities.hourly_rate` stays readable (all null today; accepted, see Risks).

| Link | After |
|---|---|
| `#/team/hours`, `#/team/hours?client=<id>` (Overview card, alerts, top bar, Settings, `LK_PLACE_CLAIMS`) | Unchanged; land on hours-only view |
| Digest Price review / Revenue snapshot (`weekly-admin-digest`, only sent to grant holders) | `#/internal/profitability` |
| Guide `profitability.md` "Team › Hours › Master Data sync", "Team → click a person" | MGB Home › Pricing & fees / Cost rates |
| Grant holder lands on Hours | One line "Fees and margin are in MGB Home ›" (`TP_PF_canSee` only), removed after 30 days |
| `#/internal/<unknown>` or no grant | Same as today: refused, falls back to Today, no hint |

## 6. Security model

One front-end gate, in a new `components/internal/MH_gate.js`:
```
MH_on()                 = localStorage mgb_home_preview === "1" OR tk_settings.mgb_home_enabled === true
MH_canOpen(real, imp)   = STAFF_canViewInternal(real, imp) && MH_on()
```
Never scatter raw checks. Money pieces keep `TP_PF_canSee(effectiveUser)` as a second guard.

| Element / query | Gate |
|---|---|
| Rail label "MGB Home", MGB Home tab row, `#/internal/<tab>` routes, ⌘K entries | `MH_canOpen(realUser, impersonating)` |
| Any `TP_PF_*` component | Mounted only inside MGB Home, plus `TP_PF_canSee` |
| `client_fees`, `staff_cost_rates`, `profitability_settings`, `master_sheet_*` | Existing RLS: admin AND `can_view_internal()` |
| `client_profitability()`, `quote_inputs()` | Existing: raise 42501 without grant |
| `qbo_hours_by_client().billable_value` | New: null without grant (S1) |
| `internal_hours()` (S2), `firm_cost_basis` + any cost-basis RPC (S3) | New: refuse/RLS without `can_view_internal()`; `firm_cost_basis` writes audited via `audit_row_change`, audit rows `firm_cost.*` added to the audit_log RESTRICTIVE policy |
| `master-sheet-sync` `compare` action (S5) | Same caller check as `preview`/`sync` |
| New tables with `client_id` | Must carry "internal company lock" (tests enforce) |
| Usage Stats | MGB Home pages log `client_id = 'mygoodbooks'` (lock hides them); test that no MGB Home view logs a null client_id |
| Staff guide article `mgb-home` | Extend the `staff_guide` RESTRICTIVE policy from one slug to a list (`profitability`, `mgb-home`) |
| Developer tools: flag row, `mgb_home_enabled` settings row, PAGE_META titles | New `internalOnly: true` field; rows render only when `STAFF_canViewInternal(realUser)`. `tk_settings` key name stays readable via API by any staff (accepted: a key name reveals nothing usable) |
| Announcement + tour | `roles: ["admin"]`, `visible: (ctx) => ANN_mgbHomeLaunchOn(ctx)` (built S1: `ctx.canSeeMoney`, not View as, and the firm switch cache `mgb_home_cache`; a preview alone never announces) |
| View as | Hidden (STAFF_canViewInternal already false while impersonating) |

## 7. Phased build plan

| Slice | Scope | Effort | Build / review |
|---|---|---|---|
| **S0** | Fix `mygoodbooks` QuickBooks sync (TransactionList 400) in `qbo-sync`. Independent of the preview. | 0.5 session | Sonnet investigates + fixes, Opus reviews (edge function) |
| **S1 (first useful slice)** | Gate file, preview flag, owner-only switch, rail relabel, MGB Home header + tab row, Home cards (without overhead card), Profitability + Pricing & fees (moved components, no new SQL), Firm books menu (regroup), Hours hours-only, `qbo_hours_by_client` null-out, digest links, staff_guide policy list, Dev Tools `internalOnly`, upkeep drafts | 1 long session | Opus builds, Opus critique + verify (preview on/off × holden/Jesse/bookkeeper), Haiku screenshot sweep |
| **S2** | Overhead: owner maps internal QuickBooks customers, `internal_hours()` RPC + tests, tab, Home card | 0.5 session | Opus builds + verifies |
| **S3** | Cost rates tab, `firm_cost_basis`, cost-basis toggle on Profitability | 0.5 session | Opus builds + verifies (money) |
| **S4** | Firm books polish after S0: close status card, last sync line, Reports default to firm P&L | 0.25 session | Sonnet builds, Opus reviews |
| **S5** | 2027 fee change review (`compare` action + tab) | 0.5 session | Opus builds + verifies (edge function, money) |
| **S6** | Capacity with money and allocation rules | 0.5 session, after OQ7 | Opus |

S1 is the smallest slice that delivers the owner's ask: MGB Home looks different, holds the money, Hours carries none.

## 8. Hidden preview rollout
- Per-person: `FEATURE_FLAGS` entry `mgb_home_preview`, "MGB Home preview", `reloads: true`, `internalOnly: true`. Tick it in Developer tools › Feature flags.
- Firm switch: `tk_settings.mgb_home_enabled`, added to `tk__owner_only_key()` (re-read the live list first). No row inserted; code never writes it. Only the four grant holders can ever see MGB Home either way.
- Preview off: byte-for-byte today's app, **except** the Hours changes, which ship ungated in S1 (they remove money from a page Jesse already sees without it; grant holders get the "moved" line pointing at MGB Home only when `MH_on()`, otherwise they keep today's money pieces on Hours until launch). Decision in OQ6.
- No Classic opt-out (four users, owner-controlled).
- Launch: Opus verify on/off → owner flips switch → publish guide article, notice, tour.

## 9. Upkeep checklist (same commit as each slice)
- Guide: new restricted article `docs/staff-guide/mgb-home.md` (audience admin, slug in the restrictive policy); update `profitability.md` (locations), `hours-budget.md`, `team-page.md`, `capacity.md`, `firm-quickbooks.md` (mapping internal customers), `mgb-internal.md` (rename, layout), `admin-guide.md`, `quickbooks-time-and-app-time.md`. Sync to `staff_guide` with targeted updates; verify old wording gone.
- What's new (`whats-new.md`, read by all staff): only a neutral line "Team › Hours shows hours only; the Billable value column is gone." Nothing about MGB Home. MGB Home's own changelog lives in the restricted `mgb-home` article.
- Tours (`Tour.jsx`): admin `team("hours")` and `profit` steps become hours-only text; new grant-only MGB Home steps (`data-tour="mh-tabs"`, `mh-home-cards`, `mh-profit`, `mh-pricing`) only when `MH_canOpen`. Bookkeeper, temp admin, account manager, client, Pro tours unchanged (assert no target removed).
- Tips (`Tips.jsx`, `tips.md`): re-point any tip on removed Hours money columns; none target them today, confirm by grep.
- Help menus: staff `?` "Help for this page" on MGB Home → `mgb-home`; client `?` unchanged.
- README: MGB Home section (gate, routes, RPCs, switch, launch checklist).
- Dev Tools: bump `window.MGB_VERSION` (neutral note), `FEATURE_FLAGS` + settings row (`internalOnly`), `PAGE_META` titles for `mgb-*` pages (`internalOnly`), `admin-insight.md`.
- Launch kit: announcement `mgb-home` with `visible` gate and 4-step tour, published only at switch flip; draft text kept in `docs/staff-guide/drafts/`.
- US spelling ("color"); say Desk, never Workbench; grep for "Team › Hours" money wording after the move.

## 10. Risks
- **Leak to Jesse** through a side door: Usage Stats (null client_id), Dev Tools rows, What's new, guide search, ⌘K, tour step text, digest. Each is in the gate table; S1 verify signs in as Jesse.
- **Two token sets on one realm** (firm Time + internal client). If Intuit rotation ever invalidates one, either sync breaks. S0 should confirm the 400 is a report-parameter issue, not auth.
- **Hours numbers shift** when the 781 h internal customer is mapped: Jesse's Unmapped bucket shrinks and those hours disappear from his view (by design of the lock). Tell the owner before mapping.
- `qbo_time_activities.hourly_rate` stays readable by any admin; harmless while QuickBooks Time sends no rates. Revisit if billing rates are ever set.
- The client Overview "Hourly rate · this month" card shows plan list price and an effective rate to any staff who opens a client; out of scope here (OQ8).
- Large surface in `app.jsx`; other sessions edit it. Ship from a worktree, rebase often.

## 11. Test plan
- SQL (new `supabase/mgb-home-tests.sql`, rolled back): as Jesse's JWT, `client_profitability()` raises, `internal_hours()` raises, `qbo_hours_by_client` billable_value all null, `firm_cost_basis` 0 rows and writes refused, `staff_guide` slug `mgb-home` 0 rows; as holden all succeed; lock test still passes.
- Node: `MH_gate` resolver (preview × switch × grant × View as); Hours CSV has no money headers without grant.
- Browser, preview on and off, as holden / Jesse (View as is not enough: real sign-in or JWT test) / a bookkeeper / temp admin: rail label, `#/internal/profitability` direct load, ⌘K, Dev Tools rows, What's new, `?` menu, Usage Stats after visiting MGB Home, digest preview.
- Regression: Overview card link to `#/team/hours?client=` opens the client drill; usage alert link; existing internal deep links `#/client/mygoodbooks/client-close` still work and highlight Firm books.
- Screenshot sweep (Haiku): MGB Home light/dark, phone width, Hours before/after.

## 12. Open questions (recommended answer first)
1. **Name in the rail?** Recommend "MGB Home" (internal tag kept in pickers).
2. **First slice scope?** Recommend S1 as written: Home, Profitability, Pricing & fees, Firm books regroup, Hours hours-only. Overhead next, then Cost rates.
3. **Tab order?** Recommend Home, Profitability, Pricing & fees, Overhead, Cost rates, Firm books, Capacity.
4. **Which cost drives margin?** Recommend per-person loaded rates stay the default (the 40% target was set on them), with a "Full cost" toggle using the firm full-cost rate; Home shows both margins.
5. **Map "My Good Books (Clock-in Option)" (781 h since July) to MGB (internal)?** Recommend yes, at S2 start; later ask staff to pick a QuickBooks Time service item (admin, training, sales) for internal time.
6. **Hours money removal: ship with S1 ungated, or hold until launch?** Recommend ungated for non-grant admins (only Billable value, always blank), and for grant holders keep money on Hours until the switch flips, then remove.
7. **What is "IHH", and how should Jesse's and Carmen's cost be allocated?** No portal client or QuickBooks customer matches "IHH". Recommend an allocation table (person, client, share, from) built in S6 once you say what IHH is.
8. **Client Overview "Hourly rate · this month" card** (plan list price, effective rate, visible to staff): leave as is, or move to MGB Home too? Recommend leave it (list prices are public) and revisit after S1.
