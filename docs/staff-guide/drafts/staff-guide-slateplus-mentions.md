# Slate plus @mentions: DRAFT guide, notice and tour text

Draft for the hidden Slate plus preview (localStorage `mgb_slateplus_preview` / firm switch `slateplus_enabled`, gate `TKP_on()` in `components/tasks/TK_slatePlus.js`). Publish at launch, when the owner flips `slateplus_enabled`. Do not copy into the live guide, `announcements.js` or `Tour.jsx` before then.

Before publishing, settle the email question (README Slate plus launch checklist, step 0): today a task @mention also sends a "mentioned you" email (Settings > Notifications, on by default), while the live guide says there is no email. The text below assumes the owner keeps the email; swap the bracketed sentence if the owner turns it off.

## docs/staff-guide/task-details.md: replace the first paragraph under `### Comments and @mentions`

````markdown
Type in **Add a comment. Type @ to mention someone.** and click **Post** (or press **Ctrl+Enter** / **⌘+Enter**). Type **@** and pick a teammate to bring them in: they get a **mentioned you** item in their bell and start following the task. [They also get an email unless they turned off task mentions in **Settings → Notifications**.] You can edit or delete your own comments. Admins can edit any comment; when someone other than the author changes one, the comment shows who edited it, for example **(edited by** and their name**)**, instead of just **(edited)**.

- The **@** list shows only people who will see the mention. Someone who can't see the task (not on the client, a private task, or an MGB (internal) task without internal access) shows grayed out with **can't see this task**, and you can't pick them.
- After you post, a short line under the box says who was notified, who couldn't see the task, and that you don't get a notice for mentioning yourself.
- A mention of you is shown in a stronger color, so you can spot where you were tagged.
- Inactive staff never show in the list and never get a notice.
````

Keywords to add to `task-details.md`: `who was notified, can't see this task, mention list, mentioned me`.

## docs/staff-guide/whats-new.md: new entry at the top (launch day)

````markdown
### <launch date>: Clearer @mentions in task comments

- The **@** list in task comments now shows only teammates who will see your mention. Anyone who can't see the task is grayed out with **can't see this task**.
- After you post, a line under the comment box says who was notified.
- Mentions of you stand out in a stronger color.
````

## Next-visit notice (components/tour/announcements.js, at launch)

- id: `slateplus-mentions`, date: the launch day, audience: staff (not View as).
- Title: **Clearer @mentions**
- Body: "In task comments, the @ list now shows only teammates who will see your mention, and a short line after you post says who was notified. Mentions of you stand out."
- Button: **Show me** (starts the tour below), **Got it**.
- Gate: firm switch only (`mgb_slateplus_cache` = "1"), like `ANN_threadMenuLaunchOn()`; a preview person sees no launch text.

## Tour (two steps, at launch)

1. Target: the comment box in task details (`.tk-cm-composer`). "Type @ to mention a teammate. Only people who can see this task are listed; anyone else is grayed out."
2. Target: the same box after a post (or the thread `.tk-cm-thread` if no post yet). "After you post, this line says who was notified. Mentions of you are shown in a stronger color."

## Tip (components/tour/Tips.jsx + docs/staff-guide/tips.md, at launch)

- id `task-mention-who`, target `.tk-cm-composer`: "Grayed-out names in the @ list can't see this task, so they wouldn't be notified."
