# Slate plus: hours vs budget chip (hidden preview)

Built 2026-10-28 (label 2026-10-28k). Gated by `TKP_useOn()` (Feature flags > Slate plus preview, or the owner-only `slateplus_enabled`; never in View as).

## 1. What it is
A small chip "used / budget h" for the current calendar month. Gray under 80% of the budget, amber from 80%, red from 100%.

Where:
- Slate client header (`TK_ClientHeader.jsx`), beside the QuickBooks pill.
- The top of the "Assign to" menu on a task row (`TK_vRowAssignee` and the Unassigned `TK_vAssignMenu` in `TK_TaskRow.jsx`), for the task's client. It mounts only while the menu is open, so rows do not each query.

Not added: the task drawer's own assignee field (no popover there), board cards, bulk bar.

## 2. Data and permissions (no new access)
Nothing new is read. `TK_HoursChip.jsx` calls `HB_useBudgets(enabled, isAdmin)` from `components/staff/HoursBudget.jsx`:
- budget: `client_profile.monthly_hours_budget` (RLS unchanged).
- hours: synced QuickBooks Time rows (`qbo_time_activities`) through `qbo_hours_by_client` (admins, every client) or `qbo_my_client_hours` (everyone else, only their own clients; `supabase/client-hours-for-bookkeepers.sql`). Both RPCs are read only and unchanged. No live QuickBooks Time feed.
- thresholds: `OPS_budgetStatus` (`staffOpsLogic.js`): near from 80%, over from 100%. Not copied.

`isAdmin` is passed explicitly (from the Slate staff list, same rule as `TK_api` `meIsAdmin`) so the Slate app window, which may sit outside the portal's staff context, still picks the right RPC. A bookkeeper therefore sees the chip only for their own clients; a client they do not cover has no hours row, so no chip.

## 3. Hidden when
Gate off or View as; client has no budget (or 0); hours unknown (QuickBooks Time not connected, no row for that client); still loading.

## 4. Drafts (not published)
Guide (`task-lists-and-projects`, "Client page"): "Next to the client's name Slate shows how many hours this month have gone into the client against its monthly budget, for example 12.5 / 20 h. It turns amber at 80% of the budget and red at 100%. You see the same chip at the top of the Assign to menu, so you can check before giving a client more work. No chip means the client has no hours budget yet. Hours come from QuickBooks Time and can be a day behind."

What's new: "Slate shows hours used against the monthly budget next to a client and in the Assign to menu, amber at 80% and red at 100%."

Notice (`slateplus-hours`, at launch): title "Hours against budget", body "Slate now shows this month's hours against the budget, next to a client and when you assign a task.", no tour (a tip is enough).

## 5. Launch
Flip `slateplus_enabled` with the rest of Slate plus (README launch checklist); publish section 4. No SQL.

## 6. Rollback
Revert the commit, or leave the switch off.
