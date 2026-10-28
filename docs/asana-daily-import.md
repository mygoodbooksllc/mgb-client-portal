# Daily Asana import (2026-10-25 to 2026-11-24)

Owner approved on 2026-10-25. Every morning a Claude scheduled task brings **new, still-open**
Asana tasks into the portal. It runs for 30 days and stops itself after **2026-11-24**. A reminder
on the morning of 2026-11-24 asks whether to keep it going.

## What runs

- **Scheduled task:** `asana-daily-import` (Claude desktop app, Scheduled). It runs daily at 6:30am local time.
  - It only runs while the Claude app is open. If the Mac is asleep or the app is closed, it runs at the next launch.
- **Reminder:** `asana-daily-import-decide`, one time, on 2026-11-24 at 8:00am local time.
- **Code:** `scripts/asana-import/dailyImport.js`, with tests in `dailyImport.test.js`.
  - It reuses the planner in `asanaImportPlan.js` and `owner-decisions.json` (Naomi's tasks go to Sonya; Hosanna is split into Woodlands and LA).
  - Each run copies the script fresh from `origin/main` into `~/Desktop/Mygoodbooks-app-code/asana-daily-runs/_code`.

Each run does these steps:

1. **Start.** `node dailyImport.js start` makes the run folder `asana-daily-runs/YYYY-MM-DD/` and prints a nonce.
   - After 2026-11-24 it prints `stop: true`. The run then pauses the scheduled task and does nothing else.
2. **Pull from Asana (read-only)** with the Asana connector:
   - `get_projects`, once with archived false and once with archived true.
   - `get_users` and `get_teams`.
   - `search_tasks` with `completed=false`, `created_at_after=2026-10-21T18:00:00Z`, sorted by `created_at` ascending, 100 per page. It pages on the last `created_at`.
   - `2026-10-21T18:00:00Z` is when the last full snapshot was taken (run 8554ad13).
   - Nothing is ever written to Asana.
3. **Extract.** `dailyImport.js extract` reads those Asana results back out of the run's own session transcript. Large results come from the files they were saved to.
4. **Read the database context.** `dailyImport.js context-sql` writes a query. The Supabase CLI runs it into `context.json`. It contains:
   - clients
   - active staff
   - which client each Asana project fed before
   - every key already imported
   - open portal tasks
   - the switch value
   - the size of the notification outbox
5. **Plan.** `dailyImport.js plan` returns one of four statuses:
   - `ready`: it wrote `stage.sql`.
   - `nothing_new`: there is nothing to import.
   - `need_parents`: a new subtask's parent must be fetched with `get_task` first.
   - `stop`: it lists the errors and nothing is applied.
6. **Stage.** `stage.sql` calls `tk_import_asana_stage`. The run is tagged `report.batch = asana-daily-YYYY-MM-DD`.
7. **Apply.** `dailyImport.js apply-sql` writes `apply.sql`, a single transaction that does three things:
   1. Turns `asana_import_apply_enabled` on.
   2. Runs `tk_import_asana_apply`.
   3. Turns the switch off.

   Any error rolls back the whole transaction, so the switch can never be left on. If the switch was already on before the run, the run stops and does not touch it.
8. **Verify and log.** `verify.sql` must show:
   - the switch is false
   - the run is applied
   - 0 duplicate Asana ids
   - the outbox is unchanged

   `dailyImport.js finish` then appends one line to `asana-daily-runs/asana-daily-import-log.txt`.

## Rules the run follows

- **New tasks only.** Any `asana:<kind>:<gid>` already in `tk_asana_import_map` is skipped, as is any task whose source_ref is already in the portal.
  - Finished Asana tasks are never pulled.
  - Portal edits are never overwritten, because existing rows are not touched.
- **Recurring-duplicate guard.** A new task is held back when an open portal task has the same client and the same title.
  - This usually happens when Asana made the next instance of a recurring task and the portal copy is still open.
  - Held-back tasks are not written to the map. They import on a later morning, once the portal copy is closed.
  - Subtasks of a held-back task are held back too.
- **Templates are not imported**, the same as in the 2026-10-21 run. Admins confirm templates in the portal.
- **Unmatched owner.** A task with no Asana assignee lands on the unassigned list, where anyone can claim it. The owner comes from the client's bookkeeper, else Holden.
- **Old parents.** A parent fetched only to place a new subtask is never imported by itself.
- **Safety stops.** The run does not apply in any of these cases:
  - more than 100 new tasks
  - more than 5 new portal projects
  - an Asana project whose tasks now map to a different client than before
  - an incomplete Asana pull
  - the last search page came back full
  - the switch was already on
- **Quiet.** The apply sets `mgb.tk_import`, so no emails or notifications go out. Verify checks the outbox.
- **Other switches.** No other firm switch is touched.

## Check on it

- **Log:** `~/Desktop/Mygoodbooks-app-code/asana-daily-runs/asana-daily-import-log.txt`, one line per run. Each line includes `new`, `skipped`, `held_back`, `unassigned`, `errors`, `switch` and `run`.
- **Claude app:** Scheduled > asana-daily-import > Runs. Each run ends with a one-line summary.
- **Database (admin):**
  ```sql
  select id, report->>'batch' batch, status, result - 'skips' from tk_import_runs
   where report->>'batch' like 'asana-daily-%' order by created_at desc;
  ```
- **Run folders** hold the pulled snapshot (names and emails). They stay on this Mac and are never committed.

## Pause, stop, undo

- **Pause:** Claude app > Scheduled > asana-daily-import > turn it off. Or ask Claude to "pause the asana-daily-import scheduled task".
- **Stop for good:** delete the scheduled task. Nothing else needs cleaning up. The switch is already off between runs.
- **Undo one day.** This soft-deletes that day's tasks only. Earlier days and portal edits on other rows are left alone. Undo works with the switch off.
  ```sql
  select id from tk_import_runs where report->>'batch' = 'asana-daily-2026-10-25';
  select public.tk_import_asana_undo('<run id>'::uuid, 'UNDO <first 8 chars of run id>');
  ```
- **Undo the one-time 2026-10-16 import** (run `49b3186a`: 1132 tasks, 16 projects, 749 draft templates; roster clients came from `supabase/asana-import-roster-clients.sql`, which this does not undo). Moved here from the Developer tools Infra links on 2026-10-28.
  ```sql
  select tk_import_asana_undo('<full run id starting 49b3186a>'::uuid, 'UNDO 49b3186a');
  ```
  Find the full id with `select id from tk_import_runs where id::text like '49b3186a%';`.

## Extend past 30 days

1. Change `STOP_DATE` in `scripts/asana-import/dailyImport.js` and ship it to main. The next run picks it up from origin/main.
2. Turn the scheduled task back on if it already paused itself.
3. Update the stop date in its prompt. In the Claude app, ask "update the asana-daily-import task: stop date <new date>".

## Known limits

- **The task window grows each day.** It starts at 2026-10-21 18:00 UTC. By late November that is about 9 search pages a morning.
- **Old skipped tasks are not retried.** Tasks that were skipped at plan time before 2026-10-21 are not picked up. For example, a client was missing then and was added later. Only tasks created after the window start are seen.
- **Held-back tasks pile up if staff keep finishing work in Asana** while the portal copies stay open.
  - On 2026-10-21 the owner chose to close the stale portal copies first (Option 1).
  - The daily run does not do that by itself, because it would edit portal rows. Ask Claude to repeat Option 1 if the held-back count keeps growing.
- **Transcript dependency.** The run reads Asana results from its own session transcript under `~/.claude/projects`. Every Asana call must come from the main session, not a subagent.
