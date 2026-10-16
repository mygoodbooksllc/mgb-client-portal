# Asana import dry-run report (Tasks Phase 2, S8)

Snapshot taken 2026-10-16T17:00:00Z from the MGB Asana workspace (read-only). Built 2026-10-16 by `scripts/asana-import/buildDryRun.js`.

This committed copy is aggregate only: no emails, staff by first name, person names in titles replaced with [name]. The named report and the machine-readable plans stay in the session scratchpad, not in git.

**Nothing has been written to the database or to Asana.** The apply RPC exists but is switched off (see Apply plan).

## Headline

|  | Today (live clients) | If every client project had a client row |
|---|---|---|
| Asana users (mapped by email / to fallback) | 10 (9 / 1) | same |
| Projects (client / onboarding / internal / tracker / skip) | 84: 59 / 10 / 9 / 1 / 5 | 84: 59 / 10 / 9 / 1 / 5 |
| Duplicate projects merged away | 3 | 3 |
| Open top-level task lines in snapshot (incl. multi-project repeats) | 1062 | 1062 |
| Open subtasks in snapshot | 851 | 851 |
| Tasks that would be created (incl. subtasks) | 160 | 1113 |
|   of which subtasks | 75 | 135 |
| Projects that would be created | 8 | 17 |
| Draft recurring templates | 0 | 743 |
| Review-step tasks (email/send reports for review) | 2 | 41 |
| Skipped | 1745 | 792 |

The portal has no real client rows yet (only the MGB internal row and two test clients), so **today almost every client task would be skipped**. The right-hand column is the same snapshot with one hypothetical client per unmatched project name; it shows what the import looks like once the client roster is loaded.

## Skipped, and why (today / if clients existed)

| Reason | Today | With clients |
|---|---|---|
| archived_duplicate_project | 27 | 27 |
| client_missing | 787 | 0 |
| duplicate_in_merged_project | 23 | 23 |
| onboarding_client_missing | 104 | 0 |
| parent_not_imported | 776 | 716 |
| project_archived | 9 | 9 |
| project_template_project | 17 | 17 |
| tracker_client_missing | 2 | 0 |

`client_missing`: the project's client is not in the portal. `project_template_project`: Asana template projects. `project_archived`: archived in Asana. `duplicate_in_merged_project` / `archived_duplicate_project`: dropped in a duplicate merge (below). `parent_not_imported`: subtask whose parent is skipped or closed.

## Duplicates merged (newest wins)

Rule used: an archived copy never wins; otherwise the latest `modified_at` wins. Every gid of the group maps to the winner, so a re-run never imports the loser. Tasks in the loser whose title and section match a winner task are dropped; the rest move into the winner. Tasks in an archived loser are dropped (flag `unionArchivedLosers` keeps them).

| Name | Kind | Gids | Winner | Winner modified | Moved in | Dropped (same title) | Dropped (archived copy) |
|---|---|---|---|---|---|---|---|
| mbtr v club | client | 1215718715307741, 1215285448822817 | 1215718715307741 | 2026-10-16 | 0 | 0 | 4 |
| collective church | onboarding | 1216724702812359, 1217023362693718 | 1217023362693718 | 2026-09-26 | 1 | 23 | 0 |
| golden city church | onboarding | 1216788123556297, 1216724702812363 | 1216788123556297 | 2026-09-20 | 0 | 0 | 23 |

## Unmatched clients (66 projects)

Each needs a client row (or an owner override to another target) before apply. `suggested id` is the slug the planner would expect.

| Asana project | gid | Target | Team | Suggested id | Open tasks |
|---|---|---|---|---|---|
| Citymark Church | 1206152428952382 | client | All Team | citymark-church | 7 |
| Creative Church | 1206152428952388 | client | Sonya's Clients | creative-church | 31 |
| Ascent | 1206160088658191 | client | Sonya's Clients | ascent | 12 |
| Believing Church | 1206194958298579 | client | Gillian's Clients | believing-church | 12 |
| CareerSpring | 1206194958298609 | client | All Team | careerspring | 3 |
| Cistern Church | 1206194958298721 | client | Nicole's Clients | cistern-church | 18 |
| City Church-Lufkin | 1206194958298842 | client | Nicole's Clients | city-church-lufkin | 18 |
| City House Church | 1206194958298891 | client | Gillian's Clients | city-house-church | 11 |
| Compassion Church | 1206194958298930 | client | Gillian's Clients | compassion-church | 18 |
| Crossings Church | 1206194958298982 | client | Nicole's Clients | crossings-church | 20 |
| Fade | 1206194958299032 | client | All Team | fade | 1 |
| Faith Family Church | 1206194958299050 | client | Debra's Clients | faith-family-church | 15 |
| Gabriel Photography | 1206194958299102 | client | Nicole's Clients | gabriel-photography | 9 |
| Good Land Church | 1206194958299125 | client | Naomi's Clients | good-land-church | 8 |
| Grace City Church | 1206194958299163 | client | Gillian's Clients | grace-city-church | 13 |
| Highpoint Church | 1206194958299205 | client | Nicole's Clients | highpoint-church | 25 |
| Hilltop Church | 1206194958299260 | client | Gillian's Clients | hilltop-church | 12 |
| Hosanna Church | 1206194958299283 | client | Debra's Clients | hosanna-church | 17 |
| Life Church | 1206194958299319 | client | Sonya's Clients | life-church | 36 |
| Life West Church | 1206194958299352 | client | Nicole's Clients | life-west-church | 17 |
| Limitless Church | 1206194958299388 | client | Gillian's Clients | limitless-church | 12 |
| Pathway Church | 1206194958299415 | client | Debra's Clients | pathway-church | 13 |
| Renaissance Church | 1206194958299457 | client | Nicole's Clients | renaissance-church | 11 |
| Vida Church | 1206194958299488 | client | Debra's Clients | vida-church | 10 |
| Vivid Church | 1206194958299522 | client | Nicole's Clients | vivid-church | 18 |
| Church at the Shores | 1206195371686740 | client | Debra's Clients | church-at-the-shores | 26 |
| Voice Church | 1206195376624295 | client | Gillian's Clients | voice-church | 13 |
| 99 Network | 1206300973610496 | client | Debra's Clients | 99-network | 10 |
| E320 (Cadency) | 1206311177667770 | client | All Team | e320-cadency | 4 |
| Zeal Church | 1206647526781255 | client | Gillian's Clients | zeal-church | 8 |
| The Plant California Initiative | 1206775627684983 | client | All Team | the-plant-california-initiative | 5 |
| Fervent Church | 1207138164443584 | client | All Team | fervent-church | 10 |
| Manna Church | 1207600069927143 | client | Nicole's Clients | manna-church | 26 |
| City Church of Lancaster | 1208135177033849 | client | All Team | city-church-of-lancaster | 8 |
| Creative Academy | 1208714924571381 | client | Nicole's Clients | creative-academy | 28 |
| Manna Retreat Center | 1209167792830183 | client | Nicole's Clients | manna-retreat-center | 19 |
| New Circle Church | 1209845148667730 | client | All Team | new-circle-church | 14 |
| Illumination | 1212666241615340 | client | Illumination Health and Home | illumination | 20 |
| Space City | 1213812035750884 | client | All Team | space-city | 16 |
| Manna Church - Clarksville | 1213825553361205 | client | All Team | manna-church-clarksville | 20 |
| Grace Reformed Baptist | 1213884260413326 | client | All Team | grace-reformed-baptist | 14 |
| Ascension of Anglican | 1213884260413330 | client | All Team | ascension-of-anglican | 15 |
| Eternal Rock | 1213884260413334 | client | All Team | eternal-rock | 12 |
| Glory Church | 1213884352397379 | client | All Team | glory-church | 14 |
| Tree City Church | 1213974522963072 | client | (no team) | tree-city-church | 11 |
| Life on Mission Church | 1214259573281978 | client | (no team) | life-on-mission-church | 11 |
| UNCO Church | 1214300045189730 | client | (no team) | unco-church | 11 |
| P23 Onboarding | 1214702463679879 | onboarding | (no team) | p23 | 8 |
| P23 Church | 1214919425567966 | client | (no team) | p23-church | 14 |
| Dreamraise Onboarding | 1214936095958970 | onboarding | (no team) | dreamraise | 11 |
| Pink Parcels | 1215294713509958 | client | (no team) | pink-parcels | 7 |
| Dreamraise | 1215436411304000 | client | (no team) | dreamraise | 15 |
| HHCR | 1215512681694189 | client | (no team) | hhcr | 1 |
| MBTR+V Club | 1215718715307741 | client | (no team) | mbtr-v-club | 11 |
| Doxa Church Onboarding | 1216239587064947 | onboarding | (no team) | doxa-church | 3 |
| The Way Church Onboarding | 1216271723868439 | onboarding | (no team) | the-way-church | 8 |
| Tampa Design | 1216298714324652 | client | (no team) | tampa-design | 7 |
| Christ Church Onboarding | 1216571219362020 | onboarding | (no team) | christ-church | 26 |
| Doxa Church | 1216598681764401 | client | (no team) | doxa-church | 15 |
| Golden City Church Onboarding | 1216788123556297 | onboarding | (no team) | golden-city-church | 9 |
| Lifot | 1216822931171605 | client | (no team) | lifot | 6 |
| Collective Church Onboarding | 1217023362693718 | onboarding | (no team) | collective-church | 25 |
| The Way Bookkeeping | 1217023362693736 | client | (no team) | the-way | 14 |
| Golden City | 1217720731515383 | client | (no team) | golden-city | 13 |
| Christ Church | 1218014065793448 | client | (no team) | christ-church | 2 |
| Fresh Start Onboarding | 1218145625601295 | onboarding | (no team) | fresh-start | 13 |

## Every project and its target

| Asana project | gid | Team | Target | Confidence | Note | Tasks (with clients) |
|---|---|---|---|---|---|---|
| Citymark Church | 1206152428952382 | All Team | client | high |  | 7 |
| Creative Church | 1206152428952388 | Sonya's Clients | client | high |  | 31 |
| Ascent | 1206160088658191 | Sonya's Clients | client | high |  | 12 |
| Believing Church | 1206194958298579 | Gillian's Clients | client | high |  | 12 |
| CareerSpring | 1206194958298609 | All Team | client | high |  | 3 |
| Cistern Church | 1206194958298721 | Nicole's Clients | client | high |  | 18 |
| City Church-Lufkin | 1206194958298842 | Nicole's Clients | client | high |  | 18 |
| City House Church | 1206194958298891 | Gillian's Clients | client | high |  | 11 |
| Compassion Church | 1206194958298930 | Gillian's Clients | client | high |  | 18 |
| Crossings Church | 1206194958298982 | Nicole's Clients | client | high |  | 20 |
| Fade | 1206194958299032 | All Team | client | high |  | 1 |
| Faith Family Church | 1206194958299050 | Debra's Clients | client | high |  | 15 |
| Gabriel Photography | 1206194958299102 | Nicole's Clients | client | high |  | 9 |
| Good Land Church | 1206194958299125 | Naomi's Clients | client | high |  | 8 |
| Grace City Church | 1206194958299163 | Gillian's Clients | client | high |  | 13 |
| Highpoint Church | 1206194958299205 | Nicole's Clients | client | high |  | 25 |
| Hilltop Church | 1206194958299260 | Gillian's Clients | client | high |  | 12 |
| Hosanna Church | 1206194958299283 | Debra's Clients | client | high |  | 17 |
| Life Church | 1206194958299319 | Sonya's Clients | client | high |  | 36 |
| Life West Church | 1206194958299352 | Nicole's Clients | client | high |  | 17 |
| Limitless Church | 1206194958299388 | Gillian's Clients | client | high |  | 12 |
| Pathway Church | 1206194958299415 | Debra's Clients | client | high |  | 13 |
| Renaissance Church | 1206194958299457 | Nicole's Clients | client | high |  | 11 |
| Vida Church | 1206194958299488 | Debra's Clients | client | high |  | 10 |
| Vivid Church | 1206194958299522 | Nicole's Clients | client | high |  | 18 |
| Church at the Shores | 1206195371686740 | Debra's Clients | client | high |  | 26 |
| Voice Church | 1206195376624295 | Gillian's Clients | client | high |  | 13 |
| 99 Network | 1206300973610496 | Debra's Clients | client | high |  | 10 |
| E320 (Cadency) | 1206311177667770 | All Team | client | high |  | 4 |
| Zeal Church | 1206647526781255 | Gillian's Clients | client | high |  | 8 |
| The Plant California Initiative | 1206775627684983 | All Team | client | high |  | 5 |
| Fervent Church | 1207138164443584 | All Team | client | high |  | 10 |
| Manna Church | 1207600069927143 | Nicole's Clients | client | high |  | 26 |
| City Church of Lancaster | 1208135177033849 | All Team | client | high |  | 8 |
| Send Reports | 1208260981750993 | All Team | internal | high |  | 0 |
| Creative Academy | 1208714924571381 | Nicole's Clients | client | high |  | 28 |
| Manna Retreat Center | 1209167792830183 | Nicole's Clients | client | high |  | 19 |
| New Circle Church | 1209845148667730 | All Team | client | high |  | 14 |
| Illumination | 1212666241615340 | Illumination Health and Home | client | high |  | 20 |
| New Client Onboarding | 1213787925210683 | All Team | tracker | high | each section is a client's onboarding | 2 |
| Space City | 1213812035750884 | All Team | client | high |  | 16 |
| Manna Church - Clarksville | 1213825553361205 | All Team | client | high |  | 20 |
| Grace Reformed Baptist | 1213884260413326 | All Team | client | high |  | 14 |
| Ascension of Anglican | 1213884260413330 | All Team | client | high |  | 15 |
| Eternal Rock | 1213884260413334 | All Team | client | high |  | 12 |
| Glory Church | 1213884352397379 | All Team | client | high |  | 14 |
| Directors Tasks | 1213889502744419 | Directors | internal | high |  | 5 |
| Owners Tasks | 1213889502744443 | Owners | internal | high |  | 3 |
| Tree City Church | 1213974522963072 | - | client | high |  | 11 |
| Employee Onboarding Template | 1213984138833247 | - | skip | high | template_project | 0 |
| New Client Template | 1213984166169341 | - | skip | high | template_project | 0 |
| Life on Mission Church | 1214259573281978 | - | client | high |  | 11 |
| UNCO Church | 1214300045189730 | - | client | high |  | 11 |
| [name] Onboarding | 1214432298121542 | - | internal | low | looks like a staff member's onboarding | 2 |
| P23 Onboarding | 1214702463679879 | - | onboarding | high |  | 8 |
| P23 Church | 1214919425567966 | - | client | high |  | 14 |
| Dreamraise Onboarding | 1214936095958970 | - | onboarding | high |  | 11 |
| Pink Parcels | 1215294713509958 | - | client | high |  | 7 |
| Dreamraise | 1215436411304000 | - | client | high |  | 15 |
| HHCR | 1215512681694189 | - | client | high |  | 1 |
| MBTR+V Club | 1215718715307741 | - | client | high |  | 11 |
| Doxa Church Onboarding | 1216239587064947 | - | onboarding | high |  | 3 |
| The Way Church Onboarding | 1216271723868439 | - | onboarding | high |  | 8 |
| Tampa Design | 1216298714324652 | - | client | high |  | 7 |
| Christ Church Onboarding | 1216571219362020 | - | onboarding | high |  | 26 |
| Doxa Church | 1216598681764401 | - | client | high |  | 15 |
| Collective Church Onboarding | 1216724702812359 | - | onboarding -> 1217023362693718 | high |  | 1 |
| Golden City Church Onboarding | 1216788123556297 | - | onboarding | high |  | 9 |
| Lifot | 1216822931171605 | - | client | high |  | 6 |
| Collective Church Onboarding | 1217023362693718 | - | onboarding | high |  | 25 |
| The Way Bookkeeping | 1217023362693736 | - | client | high |  | 14 |
| Golden City | 1217720731515383 | - | client | high |  | 13 |
| Christ Church | 1218014065793448 | - | client | high |  | 2 |
| Fresh Start Onboarding | 1218145625601295 | - | onboarding | high |  | 13 |
| COO Tasks | 1218196530005227 | - | internal | high |  | 4 |
| 90 Day | 1218322873793050 | - | internal | high |  | 31 |
| COO-SOP | 1218999398510617 | Directors | internal | high |  | 24 |
| AM-SOP | 1219046412487445 | Directors | internal | high |  | 15 |
| [name] [name]'s previously assigned tasks | 1219457099627005 | Owners | internal | medium | team Owners | 1 |
| [name]'s To Do (archived) | 1153417106098749 | - | skip | none | archived | 0 |
| Centerpoint Church (archived) | 1206159414085026 | - | skip | none | archived | 0 |
| Copeland Magic (archived) | 1206194958298971 | - | skip | none | archived | 0 |
| MBTR+V Club (archived) | 1215285448822817 | - | client -> 1215718715307741 | high |  | 0 |
| Golden City Church Onboarding (archived) | 1216724702812363 | - | onboarding -> 1216788123556297 | high |  | 0 |

## Users

Mapped by email to an active staff row; anything else goes to the fallback (the owner) with the Asana assignee name kept in the task description. Unassigned tasks go to the client's assigned bookkeeper, else the team's bookkeeper ("Nicole's Clients" -> Nicole), else the fallback.

| Asana user | Open tasks (with clients) | Goes to |
|---|---|---|
| Naomi | 34 | Holden |

**Tasks per owner (with clients):**

| Owner | Tasks |
|---|---|
| Nicole | 247 |
| Holden | 246 |
| Sonya | 200 |
| Gillian | 157 |
| Debra | 142 |
| Jesse | 67 |
| Bailley | 39 |
| Jeff | 12 |
| Carmen | 3 |

**How owners were chosen (with clients):** email 918, unassigned_fallback 123, unassigned_client_bookkeeper 38, fallback 34.

## Tasks per client (if clients existed)

| Client (suggested id) | Tasks |
|---|---|
| life-church | 39 |
| creative-church | 37 |
| church-at-the-shores | 32 |
| highpoint-church | 32 |
| manna-church | 29 |
| christ-church | 28 |
| creative-academy | 28 |
| collective-church | 26 |
| dreamraise | 26 |
| p23-church | 24 |
| golden-city | 22 |
| the-way | 22 |
| crossings-church | 20 |
| hosanna-church | 20 |
| illumination | 20 |
| life-west-church | 20 |
| manna-church-clarksville | 20 |
| space-city | 20 |
| manna-retreat-center | 19 |
| cistern-church | 18 |
| city-church-lufkin | 18 |
| compassion-church | 18 |
| doxa-church | 18 |
| renaissance-church | 18 |
| vivid-church | 18 |
| grace-city-church | 16 |
| pathway-church | 16 |
| ascension-of-anglican | 15 |
| faith-family-church | 15 |
| fervent-church | 15 |
| glory-church | 14 |
| grace-reformed-baptist | 14 |
| new-circle-church | 14 |
| city-church-of-lancaster | 13 |
| fresh-start | 13 |
| voice-church | 13 |
| ascent | 12 |
| believing-church | 12 |
| eternal-rock | 12 |
| hilltop-church | 12 |
| limitless-church | 12 |
| 99-network | 11 |
| city-house-church | 11 |
| life-on-mission-church | 11 |
| mbtr-v-club | 11 |
| tree-city-church | 11 |
| unco-church | 11 |
| vida-church | 10 |
| gabriel-photography | 9 |
| citymark-church | 8 |
| good-land-church | 8 |
| zeal-church | 8 |
| pink-parcels | 7 |
| tampa-design | 7 |
| lifot | 6 |
| the-plant-california-initiative | 5 |
| e320-cadency | 4 |
| careerspring | 3 |
| fade | 1 |
| hhcr | 1 |

**Status mapping (Task Progress custom field):** Not started -> todo, In progress -> in_progress, Incomplete -> todo, no value -> todo. An open task whose field says Done/Completed stays open, gets a note, and is flagged below. Result: todo 1113.

## Date anomalies (with clients)

| Kind | Tasks |
|---|---|
| no_due_date | 269 |
| due_on_weekend | 174 |
| overdue_over_60_days | 16 |
| open_but_progress_says_done | 12 |

No dates are changed except: a start date after the due date is dropped. Overdue tasks import as overdue so owners see them.

## 15 sample mapped rows (with clients)

| Asana gid | Title | Client | Project | Parent | Section | Status | Due | Owner | How |
|---|---|---|---|---|---|---|---|---|---|
| 1206311177667773 | Update Q1 Ask Client | e320-cadency | - | - | Monthly | todo | - | Debra | email |
| 1206754180805395 | Fade - accept all transactions to current | fade | - | - | Monthly Bookkeeping | todo | - | Debra | email |
| 1206760644519599 | Reconcile Checking | e320-cadency | - | - | Monthly | todo | - | Debra | email |
| 1207004703396476 | Reconcile CC | e320-cadency | - | - | Monthly | todo | - | Debra | email |
| 1214238747338909 | Connect bank accounts | p23-church | tracker:1213787925210683:p23 | - | P23 | todo | - | Holden | unassigned_fallback |
| 1214238747338911 | Import CoA | p23-church | tracker:1213787925210683:p23 | - | P23 | todo | - | Holden | unassigned_fallback |
| 1214718310376205 | Ask for any questions/concerns | p23-church | 1214702463679879 | - | Hand-Off Meeting | todo | - | Debra | email |
| 1213889502744471 | Create employee handbook | - | 1213889502744443 | - | - | todo | - | Bailley | email |
| 1213889502744473 | Create employee onboarding Asana list and documents | - | 1213889502744443 | - | - | todo | - | Bailley | email |
| 1213889502744482 | Catch up personal expenses and check personal budget | - | 1213889502744443 | - | - | todo | - | Holden | unassigned_fallback |
| 1217062706647506 | cash app expenses that are in ask client have to be matched  | space-city | - | 1217063386274381 | Monthly Tasks | todo | - | Holden | unassigned_fallback |
| 1217062706647515 | there will also be expenses on the Amegy checking statement  | space-city | - | 1217063386274381 | Monthly Tasks | todo | - | Holden | unassigned_fallback |
| 1214718310501519 | Review reports | p23-church | 1214702463679879 | - | Hand-Off Meeting | todo | - | Debra | email |
| 1207123728421235 | Categorize QB transactions | e320-cadency | - | - | Weekly | todo | - | Debra | email |
| 1211043609717508 | Update Creative Debt spreadsheet- SEE NOTE | creative-church | - | - | Quarterly | todo | - | Sonya | email |

## Apply plan (not run)

1. Owner answers the decisions below and loads the client roster (or gives overrides).
2. Re-take the snapshot the day of the switch, with task notes (the dry run did not pull notes), and re-run `buildDryRun.js` with `--stage-json <scratchpad>/stage-live.json`. Read `plan-live.json`; `already_imported` must be 0 on a first run.
3. Stage the plan as an admin: `select tk_import_asana_stage(<snapshot_at>, <report>, <rows>)` with the three parts of `stage-live.json`. It returns the run id and writes only to `tk_import_runs` and `tk_import_plan_rows`.
4. Turn the switch on: `insert into tk_settings(key, value) values ('asana_import_apply_enabled', 'true') on conflict (key) do update set value = 'true';`
5. Apply, as an admin: `select public.tk_import_asana_apply('<run id>', 'IMPORT <first 8 of run id>', '<fallback staff email>');`. It runs with `mgb.tk_import = on`, so no assignment emails go out. Rows are tagged with the run id in `tk_asana_import_map`; a second call creates nothing.
6. Turn the switch off again (`value = 'false'`).
7. Rollback if needed: `select public.tk_import_asana_undo('<run id>', 'UNDO <first 8 of run id>');` soft-deletes the run's tasks, archives its projects, retires its draft templates and marks the map rows undone.
