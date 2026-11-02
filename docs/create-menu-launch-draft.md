# Create menu: LAUNCHED 2026-11-02

The owner set `tk_settings.create_menu_enabled` to true on 2026-11-02. Version label 2026-11-02k.
The text below is kept as the record of what was drafted; where it differs from the shipped text, the
repo files win (the nav button now lives at the top of the staff left nav, there is an Admin group,
Upload a file and Start from a template, and the Slate app rail has its own Create menu).

Status of the launch steps:
- DONE in the launch commit: staff guide md edits (quick-actions, top-bar, getting-started, bookkeeper-guide,
  document-requests, my-tasks, inbox, notes, preview-as, workbench, add-documents, tasks-own-window, whats-new),
  the `create-menu` next-visit notice and tour (`components/tour/announcements.js`, title "Meet the Create button",
  date 2026-11-02, gated by `ANN_createLaunchOn()`), the `tk-quick-plain` tip re-pointed to `nav-create`,
  Developer tools rows (switch row says ON; preview row marked launched), `MGB_VERSION` 2026-11-02k, README.
- PENDING (lead, after review): sync the guide to the `staff_guide` table with the targeted SQL
  (`create-guide-sync.sql`, kept in the session scratchpad; regenerate by hand from the md diff if lost).
- KEPT on purpose: the preview flag `mgb_create_preview`, the gate code and the rollback (set the switch to false).
  Offer to remove the preview flag in about two weeks (around 2026-11-16).

## Launch steps
1. Final check with the preview on and off.
2. Owner sets the switch (SQL editor): `insert into tk_settings (key, value) values ('create_menu_enabled', 'true') on conflict (key) do update set value = excluded.value;`
3. Publish the guide edits, the What's new line, and add the notice/tour entry to `components/tour/announcements.js` (gate it on `CM_createOn()` plus `mgb_create_cache` = "1", like `ANN_deskPlusLaunchOn`; set its date to launch day).
4. Bump `window.MGB_VERSION` in `index.html`.
5. Keep the preview checkbox a couple of weeks, then offer to remove it.

## Staff guide (draft)
Where: `docs/staff-guide/quick-actions.md` (the + menu article) and `tips.md`; sync with a targeted `UPDATE staff_guide ... replace(...)`.

> ### Create (the + button)
> The **+ Create** button at the top of the left nav, under the logo, adds things without leaving the page. On a phone it is a round **+** in the top bar.
>
> With a client open the menu header says **Add for <client>** and everything is filled in for that client: **Task** (press **q** anywhere), **Note**, **Request a document**, **Upload a file** (takes you to that client's Documents page, on the upload box; pick the Drive folder, then the file), **Message** and, where Slate plus is on, **Start from a template** (the New project form for that client, with the Start from list ready). Off a client page you can add a **Task**; if the Desk additions are on you also get **Message a client**, **Ask client…** and **Request time off**.
>
> *Admins only:* below a line and a small **Admin** heading, **Invite a client login** (with a client open) and **Add a client** open Client roster, **Start a team review** opens HR › Reviews, and **Invite staff** opens HR › Members. These only take you to the page; nothing is created until you finish there.

## What's new (draft, not inserted)
- **2026-11-DD: A clearer Create button.** The small + in the top bar is now a **Create** button at the top of the left nav (still in the top bar on a phone) with a roomier menu: Task, Note, Request a document, Upload a file, Message and Start from a template, with an icon on each row. Admins also find Add a client, Start a team review and Invite staff there, under an Admin heading.

## Next-visit notice and tour (draft)
Notice title: "Meet the Create button". Body: "The + is now a Create button at the top of the left nav with a bigger menu. About 30 seconds."
Tour stops (target `tb-quick`, wait true):
1. "Add things from Create": "Click Create to add a task, note, document request or message for the client you have open. Press q for a task from anywhere."
2. (admins only, same target) "More for admins": "Under the Admin heading: Add a client, Start a team review and Invite staff. They open the right page."

## Already done in this commit (not draft)
`Tour.jsx` "quick" stop and the quick-add announcement read "Create" instead of "+" only while the gate is on; Developer tools has the flag row, the `create_menu_enabled` switch row, `mgb_create_cache` in the Reset notes; README has the note.
