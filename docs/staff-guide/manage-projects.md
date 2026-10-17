---
title: How do I rename, archive or trash a project?
section: Daily work
audience: admin
keywords: [project color, change project color, color, color dot, manage projects, #/tasks/manage, rename project, archive project, unarchive, trash, move to trash, restore project, restore from trash, delete project, deleted project, trashed project, trash tab, 30 days, expired trash, project owner, project list, all projects, open requests, tk_has_open_requests, restore name taken, rename or archive the active project, undo trash, projects admin]
sort: 115
---
**Manage projects** is the admin screen for every project in Slate, including archived ones and the trash. Open it from **Manage projects** under **Projects** in the Slate sidebar (`#/tasks/manage`). Only admins see it; anyone else who opens the link gets a note that it's for admins.

### What you see

One row per project with a color dot, its name, a **Onboarding for {client}** or **Internal** label, the owner, and how many tasks are open and done. A row also says **Open to all staff** when that's on, and how many client requests are still open. The chips above the list switch between **All** (everything not in the trash), **Active**, **Archived** and **Trash**, each with a count. **Find a project, client or owner** narrows the list.

### What each button does

| Button | What happens |
|---|---|
| **Rename** | Type a new name and click **Save**. Project names must be unique among projects that aren't in the trash. |
| **Color** | Opens ten color choices. Click one and the dot changes for everyone straight away. A project in the trash can't be recolored; restore it first. |
| **Archive** | Takes the project out of the sidebar and makes its tasks read-only. **Unarchive** puts it back. |
| **Move to trash** | After a confirm, hides the project and all its tasks everywhere. |
| **Restore** | On a trashed project: brings the project and its tasks back. |

### What the trash does

**Move to trash** deletes nothing. The project and its tasks disappear from every list, Slate, Waiting on client, counts, email digests and performance scores, and nobody can add a task to it. **Restore** brings back exactly the tasks the trash hid. A task someone deleted on its own before the trash stays deleted.

A project can sit in the trash as long as you like. After 30 days its row says **Past the 30-day mark**, but you can still restore it; nothing is ever purged on its own.

### When Move to trash says no

If any task in the project has a client request that is **open** or **answered** but not yet accepted (see [How do I ask a client something from a task?](#/help/ask-client)), you'll see *A task in this project is waiting on a client...* Finish or cancel that request first. The row shows how many client requests are open.

### Project owners

A project's owner can also use **Move to trash** in the **Project options** menu on the project's own page. The confirm says how many tasks go with the project and how many of them belong to other people. Changed your mind? Click **Undo** in the message that appears right after (it stays for about 10 seconds); the project and its tasks come straight back. After that, only an admin can restore it, from **Manage projects**. Everything is recorded in the **Audit log** (`tk_project.renamed`, `archived`, `unarchived`, `trashed`, `restored`, `color_set`). Owners change a project's color from **Project options › Change color**.

### Troubleshooting

- **"There's already a project with that name. Try another name."** Names are unique.
- **Restore says "Rename or archive the active project with this name first."** A project that is not in the trash already uses the trashed project's name. Rename or archive that one (or rename this one before trashing next time), then click **Restore** again. A different name is allowed while a project is in the trash, so this can happen.
- **A trashed project's link says "We couldn't find that list."** That's expected. Restore it from **Manage projects › Trash**.
- **I can't see Manage projects.** It's admins only. Temporary admins don't see it.
