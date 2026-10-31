---
title: How do Slate rules work?
section: Daily work
audience: admin
keywords: [rules, slate rules, automation, automate, new rule, dry run, recent runs, when then, trigger, action, task moves to a section, marked done, becomes overdue, assigned, auto assign, set due date, move section, system comment, follow-up task, switch a rule on, owner only, archive rule]
sort: 115
---
Part of [Slate plus](#/help/slate-plus). Admins only. Rules do small, repeat steps for you on **one project** or **one client**.

### Make a rule

1. In Slate's sidebar, open **Rules** (under **Manage projects**; on the icon sidebar it's in the **Projects** panel).
2. Click **New rule**, give it a name and pick what it applies to: a project or a client.
3. Pick **When**:
   - a task **moves to a section** (projects only),
   - a task is **marked done**,
   - a task **becomes overdue** (checked once a day), or
   - a task is **assigned** (optionally only when assigned to one person).
4. Pick **Then**: **assign** someone, **set the due date** a number of days out (business days if you like), **move it to a section**, **post a comment**, or **add a follow-up task**. Slate only offers the steps that make sense for the **When** you picked.
5. **Save.**

### Try it with Dry run

**Dry run** lists up to 25 tasks the rule would change and what it would do to each (for example *Assign Jesse Ray (now Carmen)* or *Already in Review: nothing to do*). It changes nothing, so use it before a rule goes live.

### Switching rules on

**Every rule starts off, and only the owner switches one on.** Any admin can switch a rule off. The note at the top of the page says whether rules are running right now.

### Recent runs

**Recent runs** lists the last 50 things rules did: the time, the rule, the task and what changed (from and to), or why a rule skipped a task. Use it to put a change back by hand if you need to.

### Good to know

- Rules never send emails or bell notices. A comment from a rule shows as a **System** comment, and changes show in the task's activity.
- A rule acts once per change. It never runs on a task twice for the same change.
- Rules only touch shared, top-level tasks. Reminders, private tasks and subtasks are never changed.
- An overdue rule only looks at tasks due on or after the day it was switched on, so old late tasks don't all fire at once.
- If you rename or remove a section a rule uses, the rule skips those tasks (Recent runs says why). Edit the rule.
- **Archive** stops a rule. Restoring it brings it back switched off.
