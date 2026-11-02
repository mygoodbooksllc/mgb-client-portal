# Create menu: launch draft (NOT published)

Built hidden on 2026-11-02 (label 2026-11-02b). The staff guide, What's new
entry, next-visit notice and tour below are drafts. Do not publish any of this
until the owner flips `tk_settings.create_menu_enabled` to true (the preview
checkbox `mgb_create_preview` shows the feature to one person without these).

## Launch steps
1. Final check with the preview on and off.
2. Owner sets the switch (SQL editor): `insert into tk_settings (key, value) values ('create_menu_enabled', 'true') on conflict (key) do update set value = excluded.value;`
3. Publish the guide edits, the What's new line, and add the notice/tour entry to `components/tour/announcements.js` (gate it on `CM_createOn()` plus `mgb_create_cache` = "1", like `ANN_deskPlusLaunchOn`; set its date to launch day).
4. Bump `window.MGB_VERSION` in `index.html`.
5. Keep the preview checkbox a couple of weeks, then offer to remove it.

## Staff guide (draft)
Where: `docs/staff-guide/quick-actions.md` (the + menu article) and `tips.md`; sync with a targeted `UPDATE staff_guide ... replace(...)`.

> ### Create (the + button)
> The **+ Create** button in the top bar adds things without leaving the page. On a phone it is a round **+**.
>
> With a client open the menu header says **Add for <client>** and everything is filled in for that client: **Task** (press **q** anywhere), **Note**, **Request a document** and **Message**. Off a client page you can add a **Task**; if the Desk additions are on you also get **Message a client**, **Ask client…** and **Request time off**.
>
> *Admins only:* below a line, **Invite a client login** (with a client open) and **Add a client** open Client roster, **Start a team review** opens HR › Reviews, and **Invite staff** opens HR › Members. These only take you to the page; nothing is created until you finish there.

## What's new (draft, not inserted)
- **2026-11-DD: A clearer Create button.** The small + in the top bar is now a labeled **Create** button with a roomier menu: Task, Note, Request a document and Message, with an icon on each row. Admins also find Add a client, Start a team review and Invite staff there.

## Next-visit notice and tour (draft)
Notice title: "Meet the Create button". Body: "The + in the top bar is now a labeled Create button with a bigger menu. About 30 seconds."
Tour stops (target `tb-quick`, wait true):
1. "Add things from Create": "Click Create to add a task, note, document request or message for the client you have open. Press q for a task from anywhere."
2. (admins only, same target) "More for admins": "Below the line: Add a client, Start a team review and Invite staff. They open the right page."

## Already done in this commit (not draft)
`Tour.jsx` "quick" stop and the quick-add announcement read "Create" instead of "+" only while the gate is on; Developer tools has the flag row, the `create_menu_enabled` switch row, `mgb_create_cache` in the Reset notes; README has the note.
