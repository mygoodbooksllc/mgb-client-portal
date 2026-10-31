# Slate plus person profile: launch drafts (PUBLISHED 2026-10-28w into slate-profiles.md and the slate-plus notice)

These drafts are for launch day only. Do not add them to `docs/staff-guide/`, the `staff_guide` table, `components/tour/announcements.js` or `Tour.jsx` until the owner sets `tk_settings.slateplus_enabled`. Spec: `docs/slateplus-profile-spec.md`.

## Staff guide article (draft)

Slug suggestion: `slate-person-profile`. Audience: all staff, plus one admin-only section.

### See what's on someone's plate

Every staff member has a profile page in Slate. To open it, click a person's name or face:

- on a task row in Slate (the assignee), or choose **See <name>'s profile** from the assignee menu
- on **Team › People** (Who's out, My clients' backups)
- on a shout-out

The profile shows:

- **Who they are.** Name, role, photo, and whether they are out of office (with their note and who covers their clients while they're out).
- **This week at a glance.** Open tasks, tasks due this week, late tasks and tasks waiting on a client. Late is just a count here. It does not affect anyone's score.
- **Their tasks.** Grouped Late, This week, Later and Waiting on client. You can only change a task here if you could already change it elsewhere in Slate. Otherwise the row is read-only.
- **Clients they cover.** As bookkeeper or account manager, from the clients you can see.
- **Works most with.** The people who share the most tasks with them lately.
- **Recent work.** The clients and projects they've worked on lately.
- **Shout-outs.** The latest shout-outs they received.

The page only shows what you can already see somewhere else in the app. Private tasks stay private, and clients you don't have access to never appear. Hours are not shown.

### For admins

Admins also see the person's job title and when they were last seen, plus **Open full list**, which opens their full task list.

## Next-visit notice (draft)

- id: `slateplus-profile-launch`
- Title: "New: person profiles in Slate"
- Body: "Click anyone's name in Slate, on Team or on a shout-out to see their week at a glance, their tasks, the clients they cover and who they work with. You only ever see what you could already see."
- Buttons: "Show me" (starts the tour), "Got it"
- Show only while `TKP_on()` is true.

## Tour (draft, 3 steps)

1. Target a Slate row's assignee (the `.tkp-asg-link` face): "Click a name to open that person's profile."
2. Target the glance tiles (`.tkp-glance`): "Their week at a glance: open, due this week, late and waiting on a client."
3. Target the side cards (`.tkp-side`): "Clients they cover, who they work with most, recent work and shout-outs."

At launch, add `data-tour` attributes on those three elements rather than relying on class names.

## What's new (draft)

"Person profiles in Slate: click a teammate's name to see their week, their tasks, the clients they cover and their recent shout-outs."

---

# Slate plus profile 2 and one search: launch drafts (PUBLISHED 2026-10-28w)

Drafts only. Nothing here is in the `staff_guide` table, `announcements.js`, `Tour.jsx` or `Tips.jsx` yet. Publish at launch, with the `slateplus_enabled` switch, per the README launch checklist.

## Staff guide article (draft): Your profile and one search

### One search for everything

The search box in the top bar now finds clients, tasks, projects, people and SOPs in one place. Press **Ctrl+K** (Windows) or **Cmd+K** (Mac) to jump to it from anywhere. Use the arrow keys and Enter to open a result, or Esc to close. On a phone, tap the search icon and the search opens across the top of the screen.

On the Slate page, **Filter this list** narrows the Slate list to your words instead of opening a result. A **Text** chip shows in the filter bar; click its × to clear it.

### Names open profiles

Click a person's name on a task row, in a task, in a comment or on a shout-out to open their profile. To change who a task is assigned to, use the small **Reassign** button next to the name.

### Team load has moved

Team load (open, due this week and late per person), the Unassigned count and the next 4 weeks now live on **Team › People** and on each profile, not on the Slate page.

### Make your profile yours

Open your own profile (click your name on any task row or search for yourself) to add:

- **Status.** A short line about what you're working on (up to 140 characters).
- **Local time.** Pick your time zone so teammates see your local time. If you haven't picked one, your profile shows firm time (Central).
- **Pinned.** Up to 12 clients and 12 projects you open most.
- **Focus this quarter.** Up to three goals. Tick one off when it's done. At the start of a new quarter, start fresh with **Start this quarter's goals**.
- **About me.** A few lines about you, your skills and your working hours.
- **Favorites.** Client SOPs and links you use a lot (links must start with https://).
- **Out of office.** Add time off and choose a backup for each of your clients, or the same backup for all of them.
- **Default view.** Pick one of your saved filters to open with Slate. Only you see this.

Each section you can share has a **Visible to** choice: **Only me** or **All staff**. Status, About me and local time start as All staff. Pinned, Focus and Favorites start as Only me.

**Customize** lets you choose the order of the sections and hide the ones you don't use. Use **Move up** and **Move down** to reorder (they work with the keyboard too), and **Reset to default** to start over. Everyone who opens your profile sees the same order.

There is no photo upload. Your profile picture is the same one as everywhere else in the app.

### Manager and team

Your profile shows who you report to, your direct reports and the teams you're on. Admins set managers in **HR › Employee records** and make teams on **Team › People**.

### Other people's profiles

You only see what someone has shared with All staff, and only tasks and clients you could already see somewhere else. You can't change anything on someone else's profile.

### For admins

Admins see a **Teams** card on **Team › People**, under Team load. Use **New team** to make a team (a name, an optional description and a color), then **Add people**. **Rename** and **Archive** are on each team. Archiving takes the team off everyone's profile and keeps its members on record. Admins set each person's manager in **HR › Employee records**, and the profile links there with **Change in HR › Employee records**. Admins also see **Manage in Team › Who's out** on another person's Out of office card.

## Next-visit notice (draft)

- id: `slateplus-profile2`
- Date: the day the owner flips `slateplus_enabled` (re-date at launch so the notice window starts then).
- Title: "New: one search and your own profile"
- Body: "Search clients, tasks, projects and people from the top bar (Ctrl or Cmd+K). Click a name to open a profile, and use the small button next to it to reassign. Team load is now on Team › People. Make your own profile yours with a status, your time zone, pins, goals and favorites."
- Buttons: "Show me" (starts the tour), "Got it"
- Show only while `TKP_on()` is true, never in View as.

## Tour (draft, 5 steps)

1. `data-tour="tb-search"` (top bar; `tks-search` in the Slate app bar): "Search clients, tasks, projects, people and SOPs here. Press Ctrl or Cmd+K from anywhere."
2. A Slate row's `.tkp-reassign` button (add a `data-tour="tkp-reassign"` on the first row at launch): "The name opens their profile. This button reassigns the task."
3. `data-tour="tkp-customize"` (your own profile header): "Add a status and your time zone, pin clients, set goals, then choose which sections show and in what order."
4. `data-tour="tp-team-load"` (Team › People): "Team load and the next 4 weeks live here now."
5. The Manager and team section on a profile (`.tkp2-org`; add `data-tour="tkp-org"` at launch): "Who you report to, your direct reports and your teams."

## What's new (draft)

"One search in the top bar for clients, tasks, projects, people and SOPs (Ctrl or Cmd+K). Names open profiles, with a separate Reassign button. Team load moved to Team › People. Your profile now has a status, local time, pins, quarterly goals, About me, favorites, out of office with backups, and your own section order, each shared with All staff or kept to you. Admins can set managers and make Teams."

## Tips (draft)

- Reassign (target `.tkp-reassign`): "Click a name to see that person's profile. Use the small button next to it to reassign."
- Search (target `tb-search`): "Press Ctrl+K (Cmd+K on a Mac) to search clients, tasks, projects and people from anywhere."
- The old Slate search tip `tk-search` is skipped while the gate is on (done in `Tips.jsx` by build B1).
