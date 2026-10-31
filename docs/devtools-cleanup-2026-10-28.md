# Developer tools cleanup audit, 2026-10-28

Owner request: remove anything in Settings › Firm settings › Developer tools we no longer need, especially the "Classic" views now that most are standard.

Method: every Feature flags row, every Slate switches row, INFRA_LINKS, the Reset keys and PAGE_META were read in `app.jsx`; each flag's readers were found with `git grep`; launch state was read live (read-only SELECT on `tk_settings` and `tk_settings_audit`, Supabase project `xumsqmhccgfjnlmieqyu`, run 2026-10-28). No switch was set or flipped and no data was deleted.

Decision key: **A** = launched firm-wide, old path is dead weight, remove the flag; **B** = still hidden or in preview, keep; **C** = unsure, keep and list.

## Live firm switches (tk_settings, read 2026-10-28)

| Switch | Value | Last change |
|---|---|---|
| wb_enabled | true | 2026-10-21 |
| nav_enabled | true | 2026-10-21 |
| lato_enabled | true | 2026-10-21 |
| brand_enabled | true | 2026-10-21 |
| hovernav_enabled | true | 2026-10-21 |
| slate_app_enabled | true | 2026-10-25 |
| org_profile_enabled | true | 2026-10-26 (audit: on since 2026-10-25) |
| month_rhythm_enabled | **false** | audit: turned on 2026-10-26 00:09 UTC, turned off again 2026-10-26 03:19 UTC |
| deskplus_enabled | no row (= off) | n/a |
| threadmenu_enabled | no row (= off) | n/a |
| slateplus_enabled | no row (= off) | n/a |
| ooo_auto_apply | false | 2026-10-16 |
| asana_import_apply_enabled | false | 2026-10-27 (the daily import turns it on and off inside its own transaction until 2026-11-24) |

## Feature flags (per-browser localStorage)

| Flag (localStorage key) | State | Decision | Evidence |
|---|---|---|---|
| Classic fonts `mgb_lato_classic` | lato_enabled true for everyone | **A: remove** | Opt-out only. Read in `index.html` (inline script). Without the key the result is unchanged (switch on = Lato). Firm switch and first-paint cache stay as the owner's kill switch. |
| Classic colors `mgb_brand_classic` | brand_enabled true | **A: remove** | Opt-out only. Read in `index.html` and `components/tour/announcements.js`. Same reasoning. |
| Classic menus `mgb_hovernav_classic` | hovernav_enabled true | **A: remove** | Opt-out only. Read in `HN_on()` (`HoverNav.jsx`) and `announcements.js`. |
| Classic sidebar `mgb_nav_classic` (no checkbox, key only) | nav_enabled true | **A: remove** | Opt-out only. Read in `StaffSidebar.jsx` (`SS_store`), `SS_navIsOn` (`WB_layout.js`). |
| Classic tasks page `mgb_slate_classic` | slate_app_enabled true | **A: remove** | Opt-out only. Read in `TK_store.js`, `TK_slateAppIsOn` (`TK_viewLogic.js`), `announcements.js`. |
| Classic Today `mgb_wb_classic` | wb_enabled true | **C: keep** | Looked like an opt-out (A), but it also has an in-app staff button ("Use classic Today in this browser" in `Today.jsx` and `WB_Page.jsx`, plus a "Switch back" note). Removing it would change what every staff member sees, so it stays. Readers: `WB_store.js`, `WB_isOn` (`WB_logic.js`), `announcements.js`. |
| Slate app preview `mgb_slate_app_preview` | slate_app_enabled true since 2026-10-25 | **A: remove** | Row text already says it changes nothing now. Same pattern as the five previews retired 2026-10-25. |
| Client org profile + gifts (preview) `mgb_orgprofile_preview` | org_profile_enabled true since 2026-10-25 | **A: remove** | Row text already says it changes nothing today. Read in `OP_store.js` and `announcements.js`. |
| Month rhythm preview `mgb_rhythm_preview` | month_rhythm_enabled **false** (on for about 3 hours on 2026-10-26, then switched off) | **B: keep** | Switch is off, so this is the only way to see the work. The app text and the guide claimed it was on for everyone since 2026-10-25; that is stale and was corrected in the Developer tools rows and the guide. |
| Desk additions preview `mgb_deskplus_preview` | deskplus_enabled has no row (off) | **B: keep** | Still hidden. |
| Thread menu preview `mgb_threadmenu_preview` | threadmenu_enabled has no row (off) | **B: keep** | Still hidden. |
| Slate plus preview `mgb_slateplus_preview` | slateplus_enabled has no row (off) | **B: keep** | Still hidden; another agent is building behind it. Not touched. |
| Show unreleased features `mygoodbooks_ff_unreleased_v1` | n/a | **C: keep** | Row says nothing is hidden right now, but `index.html` still reads it for the `/?install-app=1` tester override. Generic mechanism for the next hidden feature. |
| Force Pro plan `mygoodbooks_ff_force_premium_v1` | n/a | keep | QA tool, `FEATURE_FLAGS[0]` is read by index. |
| Verbose console logging `mygoodbooks_ff_verbose_logging_v1` | n/a | keep | QA tool; `FEATURE_FLAGS[1]` read at navigation. |
| Simulate slow network `mygoodbooks_ff_slow_network_v1` | n/a | keep | QA tool; read by `supabaseClient.js`. |

Kept on purpose: the seven firm switches that launched (`wb_enabled`, `nav_enabled`, `lato_enabled`, `brand_enabled`, `hovernav_enabled`, `slate_app_enabled`, `org_profile_enabled`) and their Slate switches rows, first-paint caches and "off" code paths. They are the owner's rollback (one SQL line puts the old look back for everyone), same as when the five previews were retired on 2026-10-25. Removing the old paths entirely is a bigger separate change, listed in the report.

## Slate switches rows (read-only firm settings list)

All rows are kept (they show real firm switches). Text fixes only: rows that said "Each person can opt out with Classic ... in Feature flags" lose that sentence; `month_rhythm_enabled` no longer claims to be on; rows that mention a preview flag removed above lose that mention.

## INFRA_LINKS, Reset keys, PAGE_META

| Item | Decision | Evidence |
|---|---|---|
| INFRA_LINKS (all rows) | keep, list | Each row is a live service or an applied SQL pointer. The "Asana import" row keeps the undo recipe (run 49b3186a); the daily import runs until 2026-11-24. Nothing is a dead link or a finished one-off with no use. |
| Reset local state keys | comment only | The reset matches every `mygoodbooks_` / `mgb-` / `mgb_` key except `FEATURE_FLAGS` keys. After this change the old `mgb_*_classic` and two preview keys are no longer flags, so Reset clears any stale copy (harmless; nothing reads them). Comment updated. |
| PAGE_META | keep | No page was removed. |

## Behaviour check ("no flags set")

For anyone with no flags set nothing changes: every removed branch only ran when the key was `"1"`, and every removed preview was already a no-op while its firm switch is on. Anyone who still has an old `mgb_*_classic` key in their browser now sees the standard version (the owner confirmed no flags are set).

## Part 2 (label 2026-10-28u): INFRA_LINKS and System info trims

Owner approved three changes from the audit. No database change, no switch touched.

1. **Eight finished SQL rows removed, one pointer row added** ("Supabase SQL files: see supabase/*.sql and the README"): Tasks bulk actions + undo, Tasks close checklist, Late-task grace period, Workbench, Tasks manage projects, Tasks project colors, Tasks unassigned + Asana import, Client org profile + gifts. Why: all migrations are applied, all linked to the generic SQL editor, and each file and its self-test stays in `supabase/`. Anything operational was moved first: the Asana import undo recipe (run 49b3186a, `tk_import_asana_undo`) is now in `docs/asana-daily-import.md` (the daily import runs until 2026-11-24); the Client org profile 2026-10-25 launch note and the functions list are already in the README (Client org profile section and the 2026-10-25 history line) and `docs/client-org-profile-spec.md`. The Slate plus, Rules, custom fields, agreements and other rows for hidden or unlaunched features were not touched. This replaces the "INFRA_LINKS keep" decision above for these eight rows.
2. **Slate month rhythm SQL rows merged** (slate-rhythm-1 to -5 into "Slate month rhythm SQL (slate-rhythm-1..5)"): they overlapped; the merged row keeps each file's purpose, the daily job, the late exclusion that is live for everyone, and that `month_rhythm_enabled` is still false.
3. **System info "Audit log read" row removed.** It only repeated what the Recent activity card already shows; that card keeps its own error display.
