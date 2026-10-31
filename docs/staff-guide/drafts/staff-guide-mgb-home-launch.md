# MGB Home: launch notes (S1)

MGB Home (spec: `docs/mgb-home-spec.md`) is hidden behind the per-person preview `mgb_home_preview` (Developer tools › Feature flags › MGB Home preview, shown only to admins with the MGB (internal) grant) and the owner-only firm switch `tk_settings.mgb_home_enabled`. Code never writes the switch.

Already live and gated (nothing here is visible to an admin without the MGB (internal) grant, or in View as):

- Guide article `mgb-home` (restricted by the "internal only articles" policy, like `profitability`).
- The next-visit notice and tour `mgb-home` (`components/tour/announcements.js`, `ANN_mgbHomeLaunchOn`): shows only once the firm switch is on (`mgb_home_cache` = "1"), only to grant holders, never to a preview person.
- Tour wording (`Tour.jsx`, `TOUR_mhOwnsMoney`): the admin tour's Team › Hours stop and the account-manager "Fees and hours" stop say fees and margin are in MGB Home › Profitability only for a grant holder with MGB Home on.

Deliberately NOT in the public What's new: any line naming MGB Home. Admins without the grant can read `whats-new`, so the public entry for 2026-10-31 only says Team › Hours shows hours only. The launch is announced to grant holders by the gated notice above.

## Launch day (owner flips `mgb_home_enabled`)

1. Change the `mgb-home` entry's `date` in `components/tour/announcements.js` to the launch day (the notice stops 60 days after `date`).
2. Nothing else in the public guide changes. Do not add MGB Home to `admin-insight`, `mgb-internal`, `team-page` or `whats-new`: those are readable without the grant.
3. Later slices (Overhead, Cost rates, Capacity) update `docs/staff-guide/mgb-home.md` with the md5-guarded staff_guide pattern.
