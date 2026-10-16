// Tasks Phase 2, S8: build the Asana import dry-run report from a local snapshot.
//
//   node scripts/asana-import/buildDryRun.js <snapshotDir> <outDir> [--redacted-md <path>] [--stage-json <path>]
//
// --stage-json writes {snapshot_at, report, rows:[{kind, asana_gid, payload}]} from the LIVE plan,
// the exact input for public.tk_import_asana_stage (keep it in the scratchpad too).
//
// <snapshotDir> holds (all written by the read-only snapshot pull, never committed):
//   meta.json      {snapshot_at, users, teams, projects:[{gid,name,team,archived,created_at,modified_at,open}]}
//   tasks-*.jsonl  one open top-level task per line {g,p,n,a,an,d,s,sec,cf,par,c,m,ns,mp}
//   subtasks.jsonl one open subtask per line {g,par,n,a,an,d,s,c,m,ns}
//   context.json   {fallbackEmail, today, staff:[...], clients_live:[...], overrides?, importedKeys?}
//
// Writes to <outDir> (keep it in the scratchpad: it has names and emails):
//   plan-live.json    the plan against the clients that exist today (what an apply would do now)
//   plan-whatif.json  the same snapshot if every unmatched client project had a client row
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

// One hypothetical client per unmatched name (client and onboarding projects of the same
// church share it), with the team's bookkeeper as the assigned bookkeeper.
function whatIfClients(snapshot, plan, staff) {
  var byCore = {};
  plan.report.client_missing.forEach(function (c) {
    var core = P.AI_coreName(c.name);
    var proj = snapshot.projects.filter(function (p) {
      return p.gid === c.gid;
    })[0];
    var cur = byCore[core];
    var preferThis = !cur || (cur.kind === "onboarding" && c.target_kind === "client");
    if (preferThis)
      byCore[core] = {
        id: c.suggested_client_id,
        name: c.name.replace(/\s*\b(onboarding|bookkeeping)\b\s*/gi, " ").trim(),
        kind: c.target_kind,
        assigned_bookkeeper_email: P.AI_teamBookkeeper(proj && proj.team, staff) || (cur && cur.assigned_bookkeeper_email) || null,
        hypothetical: true,
      };
    else if (!cur.assigned_bookkeeper_email) cur.assigned_bookkeeper_email = P.AI_teamBookkeeper(proj && proj.team, staff);
  });
  return Object.keys(byCore).map(function (k) {
    return byCore[k];
  });
}

function firstName(email, staff) {
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
  md += "# Asana import dry-run report (Tasks Phase 2, S8)\n\n";
  md += "Snapshot taken " + R.snapshot_at + " from the MGB Asana workspace (read-only). Built " + o.today + " by `scripts/asana-import/buildDryRun.js`.\n";
  md += red
    ? "\nThis committed copy is aggregate only: no emails, staff by first name, person names in titles replaced with [name]. The named report and the machine-readable plans stay in the session scratchpad, not in git.\n"
    : "\nFull named report. Keep out of git.\n";
  md += "\n**Nothing has been written to the database or to Asana.** The apply RPC exists but is switched off (see Apply plan).\n";

  md += "\n## Headline\n\n";
  md += table(
    ["", "Today (live clients)", "If every client project had a client row"],
    [
      ["Asana users (mapped by email / to fallback)", R.totals.asana_users + " (" + R.totals.mapped_users + " / " + R.totals.unmapped_users + ")", "same"],
      ["Projects (client / onboarding / internal / tracker / skip)", [R.totals.projects, R.totals.client, R.totals.onboarding, R.totals.internal, R.totals.tracker, R.totals.skip].join(" / ").replace(/^(\d+) \/ /, "$1: "), [W.totals.projects, W.totals.client, W.totals.onboarding, W.totals.internal, W.totals.tracker, W.totals.skip].join(" / ").replace(/^(\d+) \/ /, "$1: ")],
      ["Duplicate projects merged away", R.totals.merged_away, W.totals.merged_away],
      ["Open top-level task lines in snapshot (incl. multi-project repeats)", R.totals.open_tasks_in_snapshot, W.totals.open_tasks_in_snapshot],
      ["Open subtasks in snapshot", R.totals.open_subtasks_in_snapshot, W.totals.open_subtasks_in_snapshot],
      ["Tasks that would be created (incl. subtasks)", R.totals.to_create, W.totals.to_create],
      ["  of which subtasks", R.totals.subtasks_planned, W.totals.subtasks_planned],
      ["Projects that would be created", R.totals.projects_to_create, W.totals.projects_to_create],
      ["Draft recurring templates", R.totals.draft_templates, W.totals.draft_templates],
      ["Review-step tasks (email/send reports for review)", R.totals.review_step_tasks, W.totals.review_step_tasks],
      ["Skipped", R.totals.skipped, W.totals.skipped],
    ]
  );
  md += "\nThe portal has no real client rows yet (only the MGB internal row and two test clients), so **today almost every client task would be skipped**. The right-hand column is the same snapshot with one hypothetical client per unmatched project name; it shows what the import looks like once the client roster is loaded.\n";

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
  md += "\n`client_missing`: the project's client is not in the portal. `project_template_project`: Asana template projects. `project_archived`: archived in Asana. `duplicate_in_merged_project` / `archived_duplicate_project`: dropped in a duplicate merge (below). `parent_not_imported`: subtask whose parent is skipped or closed.\n";

  md += "\n## Duplicates merged (newest wins)\n\n";
  md += "Rule used: an archived copy never wins; otherwise the latest `modified_at` wins. Every gid of the group maps to the winner, so a re-run never imports the loser. Tasks in the loser whose title and section match a winner task are dropped; the rest move into the winner. Tasks in an archived loser are dropped (flag `unionArchivedLosers` keeps them).\n\n";
  md += table(
    ["Name", "Kind", "Gids", "Winner", "Winner modified", "Moved in", "Dropped (same title)", "Dropped (archived copy)"],
    W.duplicates.map(function (d) {
      return [nm(d.normalized_name), d.target_kind, d.gids.join(", "), d.winner_gid, String(d.winner_modified_at || "").slice(0, 10), d.tasks_merged, d.tasks_dropped, d.tasks_dropped_archived];
    })
  );

  md += "\n## Unmatched clients (" + R.client_missing.length + " projects)\n\n";
  md += "Each needs a client row (or an owner override to another target) before apply. `suggested id` is the slug the planner would expect.\n\n";
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
  md += "Mapped by email to an active staff row; anything else goes to the fallback (" + (red ? "the owner" : R.fallback_email) + ") with the Asana assignee name kept in the task description. Unassigned tasks go to the client's assigned bookkeeper, else the team's bookkeeper (\"Nicole's Clients\" -> Nicole), else the fallback.\n\n";
  md += table(
    ["Asana user", "Open tasks (with clients)", "Goes to"],
    W.unmapped_users.map(function (u) {
      return [red ? String(u.asana_name || u.asana_email || "?").split(/[\s@]/)[0] : (u.asana_name || "") + " <" + (u.asana_email || "") + ">", u.open_tasks, who(u.mapped_to)];
    })
  );
  md += "\n**Tasks per owner (with clients):**\n\n";
  md += table(["Owner", "Tasks"], sortedPairs(W.tasks_by_owner).map(function (p) { return [who(p[0]), p[1]]; }));
  md += "\n**How owners were chosen (with clients):** " + sortedPairs(W.owner_how).map(function (p) { return p[0] + " " + p[1]; }).join(", ") + ".\n";

  md += "\n## Tasks per client (if clients existed)\n\n";
  md += table(["Client (suggested id)", "Tasks"], sortedPairs(W.tasks_by_client).map(function (p) { return [p[0], p[1]]; }));
  md += "\n**Status mapping (Task Progress custom field):** Not started -> todo, In progress -> in_progress, Incomplete -> todo, no value -> todo. An open task whose field says Done/Completed stays open, gets a note, and is flagged below. Result: " + sortedPairs(W.tasks_by_status).map(function (p) { return p[0] + " " + p[1]; }).join(", ") + ".\n";

  md += "\n## Date anomalies (with clients)\n\n";
  md += table(["Kind", "Tasks"], sortedPairs(W.anomalies_by_kind));
  md += "\nNo dates are changed except: a start date after the due date is dropped. Overdue tasks import as overdue so owners see them.\n";

  md += "\n## 15 sample mapped rows (with clients)\n\n";
  md += table(
    ["Asana gid", "Title", "Client", "Project", "Parent", "Section", "Status", "Due", "Owner", "How"],
    pickSamples(wi, 15).map(function (r) {
      return [r.asana_gid, nm(r.title).slice(0, 60), r.client_id || "-", r.project_gid || "-", r.parent_gid || "-", nm(r.section || "-"), r.status, r.due_date || "-", who(r.assignee_email), r.owner_how];
    })
  );

  md += "\n## Apply plan (not run)\n\n";
  md += [
    "1. Owner answers the decisions below and loads the client roster (or gives overrides).",
    "2. Re-take the snapshot the day of the switch, with task notes (the dry run did not pull notes), and re-run `buildDryRun.js` with `--stage-json <scratchpad>/stage-live.json`. Read `plan-live.json`; `already_imported` must be 0 on a first run.",
    "3. Stage the plan as an admin: `select tk_import_asana_stage(<snapshot_at>, <report>, <rows>)` with the three parts of `stage-live.json`. It returns the run id and writes only to `tk_import_runs` and `tk_import_plan_rows`.",
    "4. Turn the switch on: `insert into tk_settings(key, value) values ('asana_import_apply_enabled', 'true') on conflict (key) do update set value = 'true';`",
    "5. Apply, as an admin: `select public.tk_import_asana_apply('<run id>', 'IMPORT <first 8 of run id>', '<fallback staff email>');`. It runs with `mgb.tk_import = on`, so no assignment emails go out. Rows are tagged with the run id in `tk_asana_import_map`; a second call creates nothing.",
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
  var ctxFile = JSON.parse(fs.readFileSync(path.join(dir, "context.json"), "utf8"));
  var snapshot = loadSnapshot(dir);
  var base = {
    staff: ctxFile.staff,
    fallbackEmail: ctxFile.fallbackEmail,
    today: ctxFile.today,
    overrides: ctxFile.overrides || {},
    importedKeys: ctxFile.importedKeys || [],
  };
  var live = P.AI_plan(snapshot, Object.assign({}, base, { clients: realClients(ctxFile.clients_live) }));
  var hypo = whatIfClients(snapshot, live, ctxFile.staff);
  var whatif = P.AI_plan(snapshot, Object.assign({}, base, { clients: realClients(ctxFile.clients_live).concat(hypo) }));
  if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "plan-live.json"), JSON.stringify(live, null, 1));
  fs.writeFileSync(path.join(out, "plan-whatif.json"), JSON.stringify(Object.assign({ hypothetical_clients: hypo }, whatif), null, 1));
  var o = { live: live, whatif: whatif, staff: ctxFile.staff, today: ctxFile.today, scrub: scrubber(snapshot) };
  fs.writeFileSync(path.join(out, "report-full.md"), render(Object.assign({}, o, { redacted: false })));
  if (redPath) fs.writeFileSync(redPath, render(Object.assign({}, o, { redacted: true })));
  if (stagePath) fs.writeFileSync(stagePath, JSON.stringify(stageRows(snapshot, live), null, 1));
  console.log(JSON.stringify({ live: live.report.totals, whatif: whatif.report.totals }, null, 1));
}

if (require.main === module) main();

module.exports = { loadSnapshot: loadSnapshot, whatIfClients: whatIfClients, render: render, stageRows: stageRows };
