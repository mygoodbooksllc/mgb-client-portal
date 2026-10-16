// Tasks Phase 2, S8: build the Asana import dry-run report from a local snapshot.
//
//   node scripts/asana-import/buildDryRun.js <snapshotDir> <outDir> [--redacted-md <path>] [--stage-json <path>]
//        [--roster-md <path>] [--decisions <owner-decisions.json>]
//
// --stage-json writes {snapshot_at, report, rows:[{kind, asana_gid, payload}]} from the LIVE plan,
// the exact input for public.tk_import_asana_stage (keep it in the scratchpad too).
//
// <snapshotDir> holds (all written by the read-only snapshot pull, never committed):
//   meta.json      {snapshot_at, users, teams, projects:[{gid,name,team,archived,created_at,modified_at,open}]}
//   tasks-*.jsonl  one open top-level task per line {g,p,n,a,an,d,s,sec,cf,par,c,m,ns,mp}
//   subtasks.jsonl one open subtask per line {g,par,n,a,an,d,s,c,m,ns}
//   context.json   {fallbackEmail, today, staff:[...], clients_live:[...], overrides?, importedKeys?}
//   qbo-customers.json (optional) the firm QuickBooks customer list from qbo_customer_client_map
//                  [{id, name, display, active, is_job, last_invoice}] for the roster step
// --decisions defaults to scripts/asana-import/owner-decisions.json (committed; first names only).
//
// Writes to <outDir> (keep it in the scratchpad: it has names and emails):
//   plan-live.json    the plan against the clients that exist today (what an apply would do now)
//   plan-whatif.json  the same snapshot with the PROPOSED ROSTER loaded as clients
//   roster-full.json  the proposed roster (owner approves before any client row is made)
//   report-full.md    the named report for the owner
// With --redacted-md, also writes an aggregate report with no emails and first names only,
// safe to commit (docs/asana-import-dry-run-report.md).
//
// Reads files, writes files. No network, no database, nothing sent to Asana.

var fs = require("fs");
var path = require("path");
var P = require("./asanaImportPlan.js");

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(function (l) {
      return l.trim();
    })
    .map(function (l) {
      return JSON.parse(l);
    });
}

function loadSnapshot(dir) {
  var meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
  var tasks = [];
  fs.readdirSync(dir)
    .filter(function (f) {
      return /^tasks-.*\.jsonl$/.test(f);
    })
    .sort()
    .forEach(function (f) {
      tasks = tasks.concat(readJsonl(path.join(dir, f)));
    });
  var subtasks = readJsonl(path.join(dir, "subtasks.jsonl"));
  var seen = {};
  subtasks = subtasks.filter(function (s) {
    if (seen[s.g]) return false;
    seen[s.g] = true;
    return true;
  });
  return { snapshot_at: meta.snapshot_at, users: meta.users, teams: meta.teams, projects: meta.projects, tasks: tasks, subtasks: subtasks };
}

function realClients(list) {
  return (list || []).filter(function (c) {
    return !c.test_only && !c.is_internal;
  });
}

function firstName(email, staff) {
  if (email === "(unassigned)") return "(unassigned)";
  if (!email) return "-";
  var s = (staff || []).filter(function (x) {
    return x.email === email;
  })[0];
  return s ? String(s.name).split(/\s+/)[0] : "(fallback)";
}

function scrubber(snapshot) {
  var names = {};
  (snapshot.users || []).forEach(function (u) {
    String(u.name || "")
      .split(/\s+/)
      .forEach(function (w) {
        if (w.length > 2) names[w] = true;
      });
  });
  snapshot.tasks.concat(snapshot.subtasks).forEach(function (t) {
    String(t.an || "")
      .split(/\s+/)
      .forEach(function (w) {
        if (w.length > 2) names[w] = true;
      });
  });
  // Former staff named in project names ("X Y's previously assigned tasks", "X Onboarding" for a person).
  (snapshot.projects || []).forEach(function (p) {
    var ob = /^([A-Z][a-z]+) Onboarding\s*$/.exec(p.name || "");
    var teamFirst =
      ob &&
      (snapshot.teams || []).some(function (t) {
        return new RegExp("^" + ob[1] + "['’]s clients", "i").test(t.name || "");
      });
    var m = /^(.+?)['’]s previously assigned/i.exec(p.name || "") || (teamFirst ? ob : null);
    if (m)
      m[1].split(/\s+/).forEach(function (w) {
        if (w.length > 2) names[w] = true;
      });
  });
  var list = Object.keys(names).sort(function (a, b) {
    return b.length - a.length;
  });
  return function (s) {
    var out = String(s == null ? "" : s);
    list.forEach(function (n) {
      out = out.replace(new RegExp("\\b" + n.replace(/[^A-Za-z0-9]/g, ".") + "('s)?\\b", "g"), "[name]$1");
    });
    return out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "[email]");
  };
}

function table(head, rows) {
  var out = "| " + head.join(" | ") + " |\n|" + head.map(function () {
    return "---";
  }).join("|") + "|\n";
  rows.forEach(function (r) {
    out += "| " + r.map(function (c) {
      return String(c == null ? "" : c).replace(/\|/g, "/").replace(/\n/g, " ");
    }).join(" | ") + " |\n";
  });
  return out;
}

function sortedPairs(obj) {
  return Object.keys(obj || {})
    .map(function (k) {
      return [k, obj[k]];
    })
    .sort(function (a, b) {
      return b[1] - a[1] || (a[0] < b[0] ? -1 : 1);
    });
}

function pickSamples(plan, n) {
  // A spread: subtasks, internal, onboarding, client, fallback-owned, review steps.
  var picks = [];
  var used = {};
  function take(fn, k) {
    plan.tasks.filter(fn).slice(0, k).forEach(function (r) {
      if (!used[r.asana_gid] && picks.length < n) {
        used[r.asana_gid] = true;
        picks.push(r);
      }
    });
  }
  take(function (r) { return r.client_id && !r.project_gid && !r.parent_gid; }, 4);
  take(function (r) { return r.project_gid && r.client_id && !r.parent_gid; }, 3);
  take(function (r) { return r.project_gid && !r.client_id && !r.parent_gid; }, 3);
  take(function (r) { return r.parent_gid; }, 2);
  take(function (r) { return r.owner_how !== "email"; }, 2);
  take(function (r) { return r.review_step; }, 1);
  take(function () { return true; }, n);
  return picks;
}

function render(o) {
  var live = o.live;
  var wi = o.whatif;
  var R = live.report;
  var W = wi.report;
  var red = o.redacted;
  var nm = red ? o.scrub : function (s) { return s; };
  var who = function (email) {
    return red ? firstName(email, o.staff) : email;
  };
  var md = "";
  md += "# Asana import dry-run report (Tasks Phase 2, S8 + S8b owner decisions)\n\n";
  md += "Snapshot taken " + R.snapshot_at + " from the MGB Asana workspace (read-only). Built " + o.today + " by `scripts/asana-import/buildDryRun.js`.\n";
  md += red
    ? "\nThis committed copy is aggregate only: no emails, staff by first name, person names in titles replaced with [name]. The named report and the machine-readable plans stay in the session scratchpad, not in git.\n"
    : "\nFull named report. Keep out of git.\n";
  md += "\n**Nothing has been written to the database or to Asana.** The apply RPC exists but is switched off (see Apply plan).\n";

  md += "\n## Headline\n\n";
  md += table(
    ["", "Today (live clients)", "With the proposed roster loaded"],
    [
      ["Asana users (mapped by email / remapped or fallback)", R.totals.asana_users + " (" + R.totals.mapped_users + " / " + R.totals.unmapped_users + ")", "same"],
      ["Projects (client / onboarding / internal / tracker / skip)", [R.totals.projects, R.totals.client, R.totals.onboarding, R.totals.internal, R.totals.tracker, R.totals.skip].join(" / ").replace(/^(\d+) \/ /, "$1: "), [W.totals.projects, W.totals.client, W.totals.onboarding, W.totals.internal, W.totals.tracker, W.totals.skip].join(" / ").replace(/^(\d+) \/ /, "$1: ")],
      ["Duplicate project copies combined into another", R.totals.merged_away, W.totals.merged_away],
      ["Open top-level task lines in snapshot (incl. multi-project repeats)", R.totals.open_tasks_in_snapshot, W.totals.open_tasks_in_snapshot],
      ["Open subtasks in snapshot", R.totals.open_subtasks_in_snapshot, W.totals.open_subtasks_in_snapshot],
      ["Tasks that would be created (incl. subtasks)", R.totals.to_create, W.totals.to_create],
      ["  of which subtasks", R.totals.subtasks_planned, W.totals.subtasks_planned],
      ["  of which left unassigned (as in Asana)", R.totals.unassigned_tasks, W.totals.unassigned_tasks],
      ["  of which open but Task Progress says Done (import as To do, flagged)", R.totals.says_done_tasks, W.totals.says_done_tasks],
      ["Projects that would be created", R.totals.projects_to_create, W.totals.projects_to_create],
      ["Draft recurring templates (created switched off)", R.totals.draft_templates, W.totals.draft_templates],
      ["Review-step tasks (email/send reports for review)", R.totals.review_step_tasks, W.totals.review_step_tasks],
      ["Skipped", R.totals.skipped, W.totals.skipped],
    ]
  );
  md += "\nThe portal has no real client rows yet (only the MGB internal row and two test clients), so **today almost every client task would be skipped**. The right-hand column is the same snapshot with the proposed roster (below and `docs/asana-import-proposed-roster.md`) loaded as clients; it shows what the import looks like once the owner approves the roster and the client rows exist.\n";
  if (o.roster) {
    var RS = o.roster.summary;
    md += "\n## Proposed client roster (owner approves; nothing created)\n\n";
    md += "Built from the Asana client and onboarding projects (copies of one client combined), matched to the firm's QuickBooks customer list. Team gives the bookkeeper (\"Nicole's Clients\" -> Nicole; Naomi's Clients -> " + (red ? "Sonya" : "the remap target") + "). Full list: `docs/asana-import-proposed-roster.md`.\n\n";
    md += table(["", "Count"], [
      ["Asana clients (proposed client rows)", RS.asana_clients],
      ["  matched to one QuickBooks customer", RS.qbo_matched],
      ["  more than one QuickBooks candidate (owner picks)", RS.qbo_ambiguous],
      ["  no QuickBooks match", RS.qbo_none],
      ["  with a bookkeeper from their Asana team", RS.with_bookkeeper],
      ["  No team yet (no Asana team)", RS.no_team_yet],
      ["Active QuickBooks customers with no Asana project", RS.qbo_only_active],
    ]);
    md += "\n**By group:** " + sortedPairs(RS.by_group).map(function (p) { return p[0] + " " + p[1]; }).join(", ") + ".\n";
    md += "\n**Tasks by roster group (with roster):** " + sortedPairs(W.tasks_by_roster_group).map(function (p) { return p[0] + " " + p[1]; }).join(", ") + ".\n";
  }

  md += "\n## Skipped, and why (today / if clients existed)\n\n";
  var reasons = {};
  Object.keys(R.skipped_by_reason).concat(Object.keys(W.skipped_by_reason)).forEach(function (k) {
    reasons[k] = true;
  });
  md += table(
    ["Reason", "Today", "With clients"],
    Object.keys(reasons)
      .sort()
      .map(function (k) {
        return [k, R.skipped_by_reason[k] || 0, W.skipped_by_reason[k] || 0];
      })
  );
  md += "\n`client_missing`: the project's client is not in the portal. `project_template_project`: Asana template projects. `project_archived`: archived in Asana (and not a copy of another project). `duplicate_in_merged_project`: an obvious repeat in a combined project (below). `parent_not_imported`: subtask whose parent is skipped or closed.\n";

  md += "\n## Duplicate projects combined (owner decision 3)\n\n";
  md += "Every copy becomes ONE project (the live, most recently modified copy gives the name; every gid maps to it, so a re-run imports nothing twice). Open tasks from all copies come along, archived copies included. Only obvious repeats drop: same title, same section and same due date as a task already kept. A client project and an onboarding project of the same church (Golden City) land on the same client.\n\n";
  md += table(
    ["Name", "Kind", "Gids", "Kept as", "Moved in from other copies", "of which from archived copy", "Dropped (obvious repeat)"],
    W.duplicates.map(function (d) {
      return [nm(d.normalized_name), d.target_kind, d.gids.join(", "), d.winner_gid, d.tasks_merged, d.tasks_from_archived, d.tasks_dropped];
    })
  );

  md += "\n## Unmatched clients (" + R.client_missing.length + " projects)\n\n";
  md += "Each needs a client row (or an owner override to another target) before apply. The proposed roster covers every one of them (copies and onboarding projects of one client share a row); `suggested id` here is only the bare slug of the project name, the roster's proposed id wins.\n\n";
  md += table(
    ["Asana project", "gid", "Target", "Team", "Suggested id", "Open tasks"],
    R.client_missing.map(function (c) {
      var p = R.projects.filter(function (x) {
        return x.gid === c.gid;
      })[0];
      var w = W.projects.filter(function (x) {
        return x.gid === c.gid;
      })[0];
      return [nm(c.name), c.gid, c.target_kind, p.team || "(no team)", c.suggested_client_id, w ? w.tasks_to_import : ""];
    })
  );

  md += "\n## Every project and its target\n\n";
  md += table(
    ["Asana project", "gid", "Team", "Target", "Confidence", "Note", "Tasks (with clients)"],
    W.projects.map(function (p) {
      return [nm(p.name) + (p.archived ? " (archived)" : ""), p.gid, p.team || "-", p.target_kind + (p.merged_into ? " -> " + p.merged_into : ""), p.confidence || "-", nm(p.reason || ""), p.tasks_to_import];
    })
  );

  md += "\n## Users\n\n";
  md += "Mapped by email to an active staff row. A departed user named in the owner decisions goes to the person named there (Naomi -> Sonya, her tasks and her team); anyone else goes to the fallback (" + (red ? "the owner" : R.fallback_email) + "). Either way the Asana assignee name stays in the task description.\n\n**Unassigned tasks stay unassigned** (owner decision 7): they show in an Unassigned group and anyone who can see the task can claim it. Each row still needs an owner behind the scenes (who can always edit it): the client's bookkeeper, else the team's bookkeeper, else the fallback. Row owners of unassigned tasks: " + sortedPairs(W.unassigned_row_owner).map(function (p) { return p[0] + " " + p[1]; }).join(", ") + ".\n\n";
  md += table(
    ["Asana user", "Open tasks (with clients)", "Goes to"],
    W.unmapped_users.map(function (u) {
      return [red ? String(u.asana_name || u.asana_email || "?").split(/[\s@]/)[0] : (u.asana_name || "") + " <" + (u.asana_email || "") + ">", u.open_tasks, who(u.mapped_to)];
    })
  );
  md += "\n**Tasks per assignee (with roster):**\n\n";
  md += table(["Owner", "Tasks"], sortedPairs(W.tasks_by_owner).map(function (p) { return [who(p[0]), p[1]]; }));
  md += "\n**How assignees were chosen (with roster):** " + sortedPairs(W.owner_how).map(function (p) { return p[0] + " " + p[1]; }).join(", ") + ".\n";

  md += "\n## Draft recurring templates (owner decision 6)\n\n";
  md += "One draft per client + cadence + title from the open tasks in Weekly / Monthly / Quarterly / Annual sections. The Asana snapshot carries no repeat settings, so each template mirrors its open Asana instance: the same weekday (weekly) or the same day of the month (monthly, quarterly, annual), Asana's exact dates (weekends kept), and the same assignee: the client's bookkeeper role when Asana had the bookkeeper, that named person when it was someone else, left unassigned when Asana had nobody. The open Asana task is linked to its template as the current period, so switching a template on does not create a second copy. **All are created switched OFF (draft)**; an admin reviews and turns each on in Tasks > Recurring.\n\n";
  md += table(["", "Templates (with roster)"], [
    ["By cadence", sortedPairs(W.templates_by_cadence).map(function (p) { return p[0] + " " + p[1]; }).join(", ")],
    ["By assignee", sortedPairs(W.templates_by_assignee_mode).map(function (p) { return p[0] + " " + p[1]; }).join(", ")],
    ["Rule notes", sortedPairs(W.templates_rule_notes).map(function (p) { return p[0] + " " + p[1]; }).join(", ") || "none"],
  ]);
  md += "\n`no_due_date`: the Asana task had no due date, so the draft keeps the default due offset; set a due rule before switching it on. `weekend_due_rolls_to_monday`: a weekly task due on a weekend lands on the Monday after. `day_clamped_in_short_months`: due on the 29th-31st, so short months use their last day. Lead time (how early the task appears): weekly 4 days, monthly 14, quarterly and annual 30.\n";

  md += "\n## Tasks per client (with roster)\n\n";
  md += table(["Client (suggested id)", "Tasks"], sortedPairs(W.tasks_by_client).map(function (p) { return [p[0], p[1]]; }));
  md += "\n**Status mapping (Task Progress custom field):** Not started -> todo, In progress -> in_progress, Incomplete -> todo, no value -> todo. An open task whose field says Done/Completed stays open, gets a note, and is flagged below. Result: " + sortedPairs(W.tasks_by_status).map(function (p) { return p[0] + " " + p[1]; }).join(", ") + ".\n";

  md += "\n## Date anomalies (with clients)\n\n";
  md += table(["Kind", "Tasks"], sortedPairs(W.anomalies_by_kind));
  md += "\nNo dates are changed except: a start date after the due date is dropped. Overdue tasks import as overdue so owners see them.\n";

  md += "\n## 15 sample mapped rows (with clients)\n\n";
  md += table(
    ["Asana gid", "Title", "Client", "Project", "Parent", "Section", "Status", "Due", "Assignee", "How"],
    pickSamples(wi, 15).map(function (r) {
      return [r.asana_gid, nm(r.title).slice(0, 60), r.client_id || "-", r.project_gid || "-", r.parent_gid || "-", nm(r.section || "-"), r.status, r.due_date || "-", r.assignee_email ? who(r.assignee_email) : "(unassigned)", r.owner_how];
    })
  );

  md += "\n## Apply plan (not run)\n\n";
  md += [
    "1. Owner approves the proposed roster (`docs/asana-import-proposed-roster.md`); the client rows are created with the normal client tools (this import never creates clients).",
    "2. Re-take the snapshot the day of the switch, with task notes (the dry run did not pull notes), and re-run `buildDryRun.js` with `--stage-json <scratchpad>/stage-live.json`. Read `plan-live.json`; `already_imported` must be 0 on a first run.",
    "3. Stage the plan as an admin: `select tk_import_asana_stage(<snapshot_at>, <report>, <rows>)` with the three parts of `stage-live.json`. It returns the run id and writes only to `tk_import_runs` and `tk_import_plan_rows`.",
    "4. Turn the switch on: `insert into tk_settings(key, value) values ('asana_import_apply_enabled', 'true') on conflict (key) do update set value = 'true';`",
    "5. Apply, as an admin: `select public.tk_import_asana_apply('<run id>', 'IMPORT <first 8 of run id>', '<fallback staff email>');`. It runs with `mgb.tk_import = on`, so no assignment emails go out. Unassigned tasks stay unassigned; templates are drafts linked to their open Asana task. Rows are tagged with the run id in `tk_asana_import_map`; a second call creates nothing.",
    "5b. Clients in the No team yet group: an admin gives each a bookkeeper with `tk_import_assign_team(client, bookkeeper)`; the client's imported tasks owned by the fallback move to that bookkeeper (unassigned ones stay unassigned).",
    "6. Turn the switch off again (`value = 'false'`).",
    "7. Rollback if needed: `select public.tk_import_asana_undo('<run id>', 'UNDO <first 8 of run id>');` soft-deletes the run's tasks, archives its projects, retires its draft templates and marks the map rows undone.",
  ].join("\n") + "\n";
  return md;
}

// The input for tk_import_asana_stage(snapshot_at, report, rows): the LIVE plan only,
// in apply order (projects, then tasks with parents first, then draft templates).
function stageRows(snapshot, plan) {
  function strip(row, drop) {
    var o = {};
    Object.keys(row).forEach(function (k) { if (drop.indexOf(k) < 0) o[k] = row[k]; });
    return o;
  }
  var rows = [];
  plan.projects.forEach(function (p) { rows.push({ kind: "project", asana_gid: p.asana_gid, payload: strip(p, ["key", "asana_gid"]) }); });
  plan.tasks.forEach(function (t) { rows.push({ kind: "task", asana_gid: t.asana_gid, payload: strip(t, ["key", "asana_gid"]) }); });
  plan.templates.forEach(function (t) { rows.push({ kind: "template", asana_gid: t.asana_gid, payload: strip(t, ["key", "asana_gid"]) }); });
  return { snapshot_at: snapshot.snapshot_at, report: plan.report.totals, rows: rows };
}

// owner-decisions.json names people by first name ({"naomi": "sonya"}); resolve to staff emails.
function resolveRemap(map, staff) {
  var out = {};
  Object.keys(map || {}).forEach(function (k) {
    var v = String(map[k] || "").toLowerCase();
    var hit = (staff || []).filter(function (s) {
      return s.active !== false && (String(s.email).toLowerCase() === v || String(s.name || "").trim().split(/\s+/)[0].toLowerCase() === v);
    });
    if (hit.length !== 1) throw new Error("owner-decisions user_remap: '" + map[k] + "' is not exactly one active staff member");
    out[String(k).toLowerCase()] = String(hit[0].email).toLowerCase();
  });
  return out;
}

// Section names of the onboarding tracker project ("New Client Onboarding"): one client each.
function trackerSections(snapshot, plan) {
  var tr = {};
  plan.project_map.forEach(function (p) {
    if (p.target_kind === "tracker") tr[p.gid] = true;
  });
  var out = [];
  snapshot.tasks.forEach(function (t) {
    if (tr[t.p] && t.sec && out.indexOf(t.sec) < 0) out.push(t.sec);
  });
  return out;
}

// The roster for owner review. Redacted: bookkeepers by first name, no emails, and
// QuickBooks-only customers that look like a person's name are counted, not listed.
function renderRoster(o) {
  var r = o.roster;
  var red = o.redacted;
  var who = function (email) {
    return !email ? "-" : red ? firstName(email, o.staff) : email;
  };
  var md = "# Proposed client roster for the Asana import (owner review)\n\n";
  md += "Built " + o.today + " by `scripts/asana-import/buildDryRun.js` from the Asana snapshot of " + o.live.report.snapshot_at + " and the firm QuickBooks customer list (`qbo_customer_client_map`). **Proposal only: no client rows were created.** Approve, edit or strike entries; the client rows are then made with the normal client tools, and the import maps Asana projects to them by name and the aliases below.\n\n";
  md += "Where the list could come from (checked 2026-10-16): QuickBooks customers (141 records, about 75 active) is the only complete source. The portal `clients` table holds only the MGB row and two test clients; `qbo_connections` holds only MGB and a sandbox; the client Google Drive has one test folder; Asana teams name the bookkeeper for 30 of the projects.\n\n";
  md += "**Columns:** proposed id (the portal client id), QuickBooks match (`high` exact name, `medium` all words of the shorter name, `acronym` e.g. MBTR+V, `first word` only the first word matches (check it), `ambiguous` more than one candidate: owner picks), bookkeeper from the Asana team (Naomi's Clients -> Sonya per owner decision 2).\n";
  var groups = [];
  r.entries.forEach(function (e) {
    if (groups.indexOf(e.group) < 0) groups.push(e.group);
  });
  groups.forEach(function (g) {
    var list = r.entries.filter(function (e) {
      return e.group === g;
    });
    md += "\n## " + g + " (" + list.length + ")\n\n";
    if (g === "No team yet") md += "No Asana team, so no bookkeeper. They import onto their client with the fallback as row owner and keep their Asana assignees; an admin gives each a bookkeeper later (`tk_import_assign_team`, UI planned: Tasks sidebar No team yet group).\n\n";
    else if (!/'s clients$/i.test(g)) md += "This Asana team does not name a bookkeeper, so these clients have none yet either; same handling as No team yet.\n\n";
    md += table(
      ["Proposed id", "Client name", "Asana projects", "QuickBooks", "Match", "Bookkeeper"],
      list.map(function (e) {
        return [
          e.proposed_client_id + (e.existing_client ? " (exists)" : ""),
          e.name,
          e.asana_projects.map(function (p) { return p.name + (p.kind === "onboarding" ? " [onboarding]" : p.kind === "tracker_section" ? " [tracker]" : "") + (p.archived ? " [archived]" : ""); }).join("; "),
          e.qbo ? e.qbo.name + " (#" + e.qbo.id + (e.qbo.active ? "" : ", inactive") + ")" : e.qbo_candidates.length ? e.qbo_candidates.map(function (q) { return q.name + " #" + q.id; }).join(" or ") : "-",
          e.qbo_confidence,
          who(e.bookkeeper_email),
        ];
      })
    );
  });
  var personal = r.qbo_only.filter(function (q) { return q.looks_personal; });
  var orgs = r.qbo_only.filter(function (q) { return !q.looks_personal; });
  md += "\n## Active in QuickBooks, no Asana project (" + r.qbo_only.length + ")\n\n";
  md += "Possibly clients with no open Asana work, billing-only customers or old records. Owner: add any that should be portal clients.\n\n";
  md += table(["QuickBooks customer", "#", "Last invoice"], (red ? orgs : r.qbo_only).map(function (q) { return [q.name, q.id, q.last_invoice || "-"]; }));
  if (red && personal.length) md += "\nPlus " + personal.length + " customer(s) named like a person, not listed here (see the scratchpad roster-full.md).\n";
  return md;
}

function main() {
  var args = process.argv.slice(2);
  var dir = args[0];
  var out = args[1];
  if (!dir || !out) {
    console.error("usage: node buildDryRun.js <snapshotDir> <outDir> [--redacted-md <path>] [--stage-json <path>]");
    process.exit(2);
  }
  var redPath = args.indexOf("--redacted-md") >= 0 ? args[args.indexOf("--redacted-md") + 1] : null;
  var stagePath = args.indexOf("--stage-json") >= 0 ? args[args.indexOf("--stage-json") + 1] : null;
  var rosterPath = args.indexOf("--roster-md") >= 0 ? args[args.indexOf("--roster-md") + 1] : null;
  var decPath = args.indexOf("--decisions") >= 0 ? args[args.indexOf("--decisions") + 1] : path.join(__dirname, "owner-decisions.json");
  var decisions = fs.existsSync(decPath) ? JSON.parse(fs.readFileSync(decPath, "utf8")) : {};
  var qboFile = path.join(dir, "qbo-customers.json");
  var qbo = fs.existsSync(qboFile) ? JSON.parse(fs.readFileSync(qboFile, "utf8")) : [];
  var ctxFile = JSON.parse(fs.readFileSync(path.join(dir, "context.json"), "utf8"));
  var snapshot = loadSnapshot(dir);
  var base = {
    staff: ctxFile.staff,
    fallbackEmail: ctxFile.fallbackEmail,
    today: ctxFile.today,
    overrides: ctxFile.overrides || {},
    importedKeys: ctxFile.importedKeys || [],
    userRemap: resolveRemap(decisions.user_remap, ctxFile.staff),
  };
  var live = P.AI_plan(snapshot, Object.assign({}, base, { clients: realClients(ctxFile.clients_live) }));
  var roster = P.AI_buildRoster({
    projects: live.project_map,
    trackerSections: trackerSections(snapshot, live),
    qbo: qbo,
    staff: ctxFile.staff,
    userRemap: base.userRemap,
    liveClients: ctxFile.clients_live,
  });
  var rosterClients = P.AI_rosterClients(roster).filter(function (c) {
    return !realClients(ctxFile.clients_live).some(function (l) {
      return l.id === c.id;
    });
  });
  var whatif = P.AI_plan(snapshot, Object.assign({}, base, { clients: realClients(ctxFile.clients_live).concat(rosterClients) }));
  if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "plan-live.json"), JSON.stringify(live, null, 1));
  fs.writeFileSync(path.join(out, "plan-whatif.json"), JSON.stringify(Object.assign({ roster_clients: rosterClients }, whatif), null, 1));
  fs.writeFileSync(path.join(out, "roster-full.json"), JSON.stringify(roster, null, 1));
  var o = { live: live, whatif: whatif, roster: roster, staff: ctxFile.staff, today: ctxFile.today, scrub: scrubber(snapshot) };
  fs.writeFileSync(path.join(out, "roster-full.md"), renderRoster(Object.assign({}, o, { redacted: false })));
  if (rosterPath) fs.writeFileSync(rosterPath, renderRoster(Object.assign({}, o, { redacted: true })));
  fs.writeFileSync(path.join(out, "report-full.md"), render(Object.assign({}, o, { redacted: false })));
  if (redPath) fs.writeFileSync(redPath, render(Object.assign({}, o, { redacted: true })));
  if (stagePath) fs.writeFileSync(stagePath, JSON.stringify(stageRows(snapshot, live), null, 1));
  console.log(JSON.stringify({ live: live.report.totals, whatif: whatif.report.totals, roster: roster.summary }, null, 1));
}

if (require.main === module) main();

module.exports = { loadSnapshot: loadSnapshot, render: render, renderRoster: renderRoster, stageRows: stageRows, resolveRemap: resolveRemap };
