# MGB Home: launch notes (S1 to S5)

> **PUBLISHED 2026-11-06** (label 2026-11-06c, launch of six previews). The live text is in `docs/staff-guide/` and `supabase/launch-2026-11-06.sql`; this draft is kept for reference.

MGB Home (spec: `docs/mgb-home-spec.md`) is hidden behind the per-person preview `mgb_home_preview` (Developer tools › Feature flags › MGB Home preview, shown only to admins with the MGB (internal) grant) and the owner-only firm switch `tk_settings.mgb_home_enabled`. Code never writes the switch.

Already live and gated (nothing here is visible to an admin without the MGB (internal) grant, or in View as):

- Guide article `mgb-home` (restricted by the "internal only articles" policy, like `profitability`).
- The next-visit notice and tour `mgb-home` (`components/tour/announcements.js`, `ANN_mgbHomeLaunchOn`): shows only once the firm switch is on (`mgb_home_cache` = "1"), only to grant holders, never to a preview person.
- Tour wording (`Tour.jsx`, `TOUR_mhOwnsMoney`): the admin tour's Team › Hours stop and the account-manager "Fees and hours" stop say fees and margin are in MGB Home › Profitability only for a grant holder with MGB Home on.

Deliberately NOT in the public What's new: any line naming MGB Home. Admins without the grant can read `whats-new`, so the public entry for 2026-10-31 only says Team › Hours shows hours only. The launch is announced to grant holders by the gated notice above.

## Launch day (owner flips `mgb_home_enabled`)

1. Change the `mgb-home` entry's `date` in `components/tour/announcements.js` to the launch day (the notice stops 60 days after `date`).
2. Nothing else in the public guide changes. Do not add MGB Home to `admin-insight`, `mgb-internal`, `team-page` or `whats-new`: those are readable without the grant.
3. Later slices (Capacity) update `docs/staff-guide/mgb-home.md` with the md5-guarded staff_guide pattern.

## S2 Overhead (2026-10-31)

- Live now for everyone (not gated, neutral wording): the clock-in customer **My Good Books (Clock-in Option)** is mapped to the internal client, so its time leaves client and Unmapped hours for every admin. Public guide lines in `firm-quickbooks` and `whats-new` say only that; they never name MGB Home, Overhead or cost.
- Gated (grant holders only): the `mgb-home` article's Overhead section and fourth Home card, the `ann-mh-overhead` step in the `mgb-home` notice, the ⌘K row and the `mgb-overhead` page. The internal mapping row is hidden from, and can't be changed by, admins without the grant.
- If other QuickBooks customers are internal time too, the owner maps them to MGB (internal) on the mapping page; Overhead picks them up with no code change.

## S3 Cost rates (2026-11-02)

- Nothing public changes, so there is no `whats-new` line: the staff cost rates list already lived on MGB Home › Profitability (grant only), and Team › Hours keeps its person rate card for when MGB Home is off.
- Gated (grant holders only): the `mgb-costs` page (`#/internal/costs`), the Staff cost / Full cost toggle, the `mgb-home` and `profitability` article lines, the ⌘K row, the `firm_cost.*` audit rows and the `ann-mh-costs` step. The `mgb-home` notice keeps 6 steps: the old Firm books step is folded into `ann-mh-costs`. Notice gating is unchanged.
- Before launch the owner enters the firm cost basis (staff rate and full rate per hour) on Cost rates; Full cost stays grayed out until then. People with no rate (shown as "needs rate") are costed at the average and marked estimated.

## S4 Firm books polish (2026-11-02)

- Nothing public changes, so there is no `whats-new` line: the Firm books card, the sync line and the firm Profit & Loss card show only inside MGB Home (grant holders with it on), and the firm's close, sync and P&L rows were already hidden by the internal company lock.
- Gated (grant holders only): the Home card's close badge, reasons and due/late line, the last-sync line with its warnings and Sync now, the **Firm Profit & Loss** card at the top of Firm books › Reports, the `mgb-home` article lines and the `ann-mh-home` / `ann-mh-costs` wording. The notice keeps 6 steps.
- Nothing for the owner to set. If the firm's QuickBooks needs reconnecting, the card says so and points to Setup.

## S5 2027 fee change review (2026-11-02)

- Nothing public changes, so there is no `whats-new` line: the review is a card on MGB Home › Pricing & fees (grant holders with MGB Home on), and the `compare` action of `master-sheet-sync` refuses anyone without `can_view_internal()`, like Preview and Sync now.
- Gated (grant holders only): the **2027 fee change review** card, the `mgb-home` and `profitability` article lines and the `ann-mh-pricing` wording. The notice keeps 6 steps.
- Deploy: the `master-sheet-sync` edge function must be redeployed for the card to work (until then the card says "unknown action"). The live `sync` path and the nightly run are unchanged.
- Read only: the review writes nothing, not even a run log row, and does not log a usage event (`MGB_track` rows carry no client id, so admins without the grant could see them).

## S6 Capacity (2026-11-02)

- Nothing public changes, so there is no `whats-new` line: plain hours capacity stays on Team › Hours for every admin, and the money version lives only on MGB Home › Capacity (grant holders with MGB Home on).
- Gated (grant holders only): the `mgb-capacity` page (`#/internal/capacity`), its ⌘K row and help-menu entry, the `mgb-home` article's Capacity section and keywords, the `cost_contract.*` / `cost_alloc.*` audit rows and the `ann-mh-capacity` step. The `mgb-home` notice keeps 6 steps: Cost rates is folded into the Capacity step (`ann-mh-costs` is gone). Usage rows for the page, the ⌘K jump and guide searches for capacity, allocation or IHH carry the internal client id, so admins without the grant never see them.
- Seeded: IHH (Illumination Health and Home) as the one contract client and one fixed 100% share for the person who works only on IHH. Nobody else has a rule; anyone who splits time follows their logged hours on IHH each month. Before launch the owner checks the IHH split on Capacity and adds a fallback share only for someone whose months without logged hours should not count as all MGB.
