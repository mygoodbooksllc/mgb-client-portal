-- staff-guide-slate-single-home.sql
--
-- Owner decision 2026-10-27: the Slate page is the one full Slate; Work > Slate becomes a short summary
-- (late, due today, next 5, Open Slate). Guide text only. Built from the live staff_guide text read on
-- 2026-10-27 (md5 of each body_md is checked first; if a live article changed since, the block raises and
-- nothing is written). Replaces only; never deletes. body_plain is generated, never updated.
--
-- Applied to production 2026-10-27.
do $$
declare n int;
begin
  update public.staff_guide set
    body_md = replace(replace(replace(body_md, $q$**Slate** (`#/work/tasks`): **Slate**, everything assigned to you, grouped as Overdue, Today, This week, Later, Waiting on client and Done. See [How do I use my Slate?](#/help/my-tasks). For client lists and projects, open the full Slate page from the **Slate** button in the top bar; see [How do client task lists and projects work?](#/help/task-lists-and-projects).$q$, $q$**Slate** (`#/work/tasks`): a short summary of your Slate: what's **Late**, what's **Due today**, and your **Next** five tasks, with an **Open Slate** button to the full Slate page. Click a row to open the task, the same way as on the Slate page. The Slate page is the one full Slate, with the groups, filters, right-click, drag, select-many and swipes. See [How do I use my Slate?](#/help/my-tasks). For client lists and projects, use the Slate page too; see [How do client task lists and projects work?](#/help/task-lists-and-projects). If you're on the **Classic tasks page**, or the Slate app is switched off, this tab still shows the full list as before.$q$), $q$**Slate** is a read-only snapshot of their tasks with private tasks hidden, and nothing on it can be changed or popped out.$q$, $q$**Slate** is a read-only snapshot of their tasks with private tasks hidden, and nothing on it can be changed or popped out. (It is the full snapshot, not the short summary.)$q$), $q$- Today's **Open Slate** link$q$, $q$- Work › Slate's **Open Slate** button, Today's **Open Slate** link$q$),
    updated_at = now()
  where slug = 'work-page' and md5(body_md) = '5da04a8c2f6458ed0f8eb67850a46549';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'work-page changed since it was read (md5 mismatch)'; end if;

  update public.staff_guide set
    body_md = replace(body_md, $q$or from **Work › Slate** (`#/work/tasks`), which shows the same list inside Work.$q$, $q$or from **Open Slate** on **Work › Slate** (`#/work/tasks`), which shows just a short summary (late, due today and your next five tasks) inside Work. The Slate page is the one full Slate. If you're on the Classic tasks page, **Work › Slate** still shows the full list.$q$),
    updated_at = now()
  where slug = 'my-tasks' and md5(body_md) = '08290743d3280dd01c2a2458dd099d32';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'my-tasks changed since it was read (md5 mismatch)'; end if;

  update public.staff_guide set
    body_md = replace(body_md, $q$**Slate page** goes to the full page.$q$, $q$**Open in Slate** goes to the full Slate page.$q$),
    updated_at = now()
  where slug = 'workbench' and md5(body_md) = '68c3c08f43dbd6bc0258a15d3cb9fd7d';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'workbench changed since it was read (md5 mismatch)'; end if;

  update public.staff_guide set
    body_md = replace(replace(body_md, $q$- **I miss the long list.** Open **Work › Slate**, or press$q$, $q$- **I miss the long list.** Click **Open Slate**, or press$q$), $q$The full list lives in **Work › Slate** and,$q$, $q$The full list lives on the Slate page (**Open Slate**; **Work › Slate** has a short summary of it) and,$q$),
    updated_at = now()
  where slug = 'home-page' and md5(body_md) = '68ff0cde69664d5a2a0b866225209a4c';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'home-page changed since it was read (md5 mismatch)'; end if;

  update public.staff_guide set
    body_md = replace(body_md, $q$**Work › Slate** (Slate inside Work)$q$, $q$**Work › Slate** (a short Slate summary inside Work)$q$),
    updated_at = now()
  where slug = 'staff-settings' and md5(body_md) = '26f6e71328b6d21d395058839d23b55c';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'staff-settings changed since it was read (md5 mismatch)'; end if;

  update public.staff_guide set
    body_md = replace(replace(replace(body_md, $q$These show on **Work › Slate** (the Slate pages), after the tips above.$q$, $q$These show on the Slate pages, after the tips above. **Work › Slate** is a short summary with its own tip.$q$), $q$| Work › Slate | Pick a client and tick Share$q$, $q$| Slate | Pick a client and tick Share$q$), $q$| Page | Tip | Learn more |
|---|---|---|
| Slate | Press q on any staff page$q$, $q$| Page | Tip | Learn more |
|---|---|---|
| Work › Slate | This tab shows what's late, due today and coming up next. Open Slate has the full list. | [How do I use my Slate?](#/help/my-tasks) |
| Slate | Press q on any staff page$q$),
    updated_at = now()
  where slug = 'tips' and md5(body_md) = '754e66cca0b8fa37c7c5211009a1a274';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'tips changed since it was read (md5 mismatch)'; end if;

  update public.staff_guide set
    body_md = replace(body_md, $q$### 2026-10-27: celebrations are for admins only (for now)$q$, $q$### 2026-10-27: Work › Slate is now a short summary
- **One full Slate.** The Slate page is now the only full Slate. **Work › Slate** shows a short summary instead: what's **Late**, what's **Due today**, and your **Next** five tasks, with an **Open Slate** button. Click a row to open the task, just as you would on the Slate page; if there are more, a line says so and links to Slate.
- **Nothing else moved.** Notes & SOPs, Close, Deadlines and Ledger review are unchanged. The Desk keeps its compact **Slate** tab, now with an **Open in Slate** link. On the Classic tasks page, **Work › Slate** is unchanged. See [What's on the Work page?](#/help/work-page).

### 2026-10-27: celebrations are for admins only (for now)$q$),
    updated_at = now()
  where slug = 'whats-new' and md5(body_md) = '71a9973c1803b6426b6e0813f1a457f6';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'whats-new changed since it was read (md5 mismatch)'; end if;

end;
$$;
