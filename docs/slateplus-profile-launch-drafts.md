# Slate plus person profile: launch drafts (NOT PUBLISHED)

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
