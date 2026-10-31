# DRAFT (published 2026-10-28w into slate-profiles.md and team-page.md): Slate plus Team load strip

Publish only at launch (README "Slate plus (hidden), launch checklist"). Nothing here is in the live `staff_guide` table yet.

## Guide text for `docs/staff-guide/my-tasks.md` (section "Team load")

### Team load (who is busy this week)
At the top of the Slate page, under the view bar, **Team load** shows how much each person has on their plate this week:
- **due**: open tasks due this week (Monday to Sunday)
- **open**: all their open tasks (tasks waiting on the client don't count; they're on the client)
- **late**: shown only once late tasks count against staff (after the grace period)
- Admins also see **Has room** or **Overloaded** from Team › Capacity (based on each person's average QuickBooks Time hours over complete, fully synced weeks, against their weekly target).

The busiest person is first, and the bar compares each person with the busiest one. Click the arrow to fold the strip away; Slate remembers that in this browser.

**Who sees what.** Admins and account managers see everyone. Everyone else sees only their own load. Admins can click a person to open their list; click **You** to go back to your Slate.

**Before you claim or assign.** The **Unassigned** group shows the same load as one line ("Team load this week: Ben 7 · Ana 3 · You 3") so you can see who has room before you claim a task or pick an assignee.

Keywords: team load, workload, overloaded, who is busy, capacity, assign, claim

## What's new line (`whats-new.md`)
### <launch date>: Team load on the Slate page
See who is busy this week before you hand out work: open, due this week and hours (admins) per person at the top of Slate, and as one line in the Unassigned group.

## Tip (`tips.md`, catalog id `slate-team-load`, target `data-tour="tkw-strip"`)
**Team load.** See who has room this week before you assign or claim a task. Fold it away with the arrow.

## Tour step (Slate tour, after the view bar stop; target `tkw-strip`)
**Team load.** Each person's open tasks and tasks due this week, busiest first. Admins also see **Has room** or **Overloaded** against their weekly target. Admins and account managers see everyone; everyone else sees their own load.

## Next-visit notice (`announcements.js`, id `slateplus-team-load`, gate on `mgb_slateplus_cache` = "1" and not View as)
Title: **New on Slate: Team load**
Body: See who is busy this week before you assign or claim work. It's at the top of your Slate page. Take the short tour?
