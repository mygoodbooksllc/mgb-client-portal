#!/usr/bin/env node
// Daily Asana import (owner approved 2026-10-25): every morning, bring NEW and still-OPEN
// Asana tasks into the portal. Runs through STOP_DATE, then does nothing.
// Runbook: docs/asana-daily-import.md
//
// Asana is read-only here: the Claude session pulls with the Asana connector (search_tasks,
// get_projects, get_users, get_teams, get_task) and this script reads those results back
// out of the session transcript. Nothing is ever written to Asana.
//
// Steps (each prints one JSON line):
//   start     [--today YYYY-MM-DD] [--root DIR]   -> run dir, nonce, stop flag
//   extract   --dir D                             -> D/asana.json (Asana calls made after the nonce)
//   context-sql --dir D                           -> D/context.sql (run with the Supabase CLI into D/context.json)
//   plan      --dir D                             -> status ready | nothing_new | need_parents | stop
//                                                    ready writes D/stage.sql
//   apply-sql --dir D --run <uuid>                -> D/apply.sql (switch on, apply, switch off: one transaction)
//                                                    and D/verify.sql
//   finish    --dir D [--run <uuid>] [--verify D/verify.json] [--note text]
//                                                 -> appends one line to the log file
"use strict";
var fs = require("fs");
var path = require("path");
var os = require("os");
var crypto = require("crypto");
var P = require("./asanaImportPlan.js");
var B = require("./buildDryRun.js");

var STOP_DATE = "2026-11-24"; // last day that imports; after it, every run is a no-op
var WINDOW_START = "2026-10-21T18:00:00Z"; // cutoff of the last full Asana snapshot (run 8554ad13)
var CAP_TASKS = 100; // more new tasks than this in one run = stop and report, do not apply
var CAP_PROJECTS = 5; // more new portal projects than this = stop and report
var FALLBACK = "holden@mygoodbooks.org";
// Draft recurring templates stay out, as in the 2026-10-21 run (owner reviews templates in the
// portal). Flip only on owner request; same-client+cadence+title drafts are skipped either way.
var IMPORT_TEMPLATES = false;
var OVERRIDES = {
  "1219641450330572": { target_kind: "client", client_id: "3circle-church", note: "owner: 3 Circle = 3Circle Church" },
};
var DEFAULT_ROOT = path.join(os.homedir(), "Desktop", "Mygoodbooks-app-code", "asana-daily-runs");
var LOG_FILE = "asana-daily-import-log.txt"; // inside the runs root

function arg(name, dflt) {
  var a = process.argv.indexOf("--" + name);
  return a >= 0 ? process.argv[a + 1] : dflt;
}
function out(o) {
  console.log(JSON.stringify(o));
}
function localToday() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function readJson(f) {
  return JSON.parse(fs.readFileSync(f, "utf8"));
}
function norm(s) {
  return String(s == null ? "" : s)
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ---------- start ----------
function cmdStart() {
  var today = arg("today", localToday());
  var root = arg("root", DEFAULT_ROOT);
  var stop = today > STOP_DATE;
  var dir = path.join(root, today);
  for (var n = 2; fs.existsSync(dir); n++) dir = path.join(root, today + "-run" + n); // a re-run the same day keeps its own folder
  var nonce = "ASANA-DAILY-NONCE-" + today + "-" + crypto.randomBytes(6).toString("hex");
  if (!stop) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "nonce.txt"), nonce);
    fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify({ today: today, nonce: nonce }));
  }
  out({ step: "start", today: today, stop_date: STOP_DATE, stop: stop, dir: dir, window_start: WINDOW_START, nonce: nonce });
}

// ---------- extract: Asana results from this session's transcript ----------
function findTranscript(nonce) {
  var base = path.join(os.homedir(), ".claude", "projects");
  var cutoff = Date.now() - 12 * 3600 * 1000;
  var hits = [];
  (function walk(d, depth) {
    if (depth > 4) return;
    var list;
    try {
      list = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      return;
    }
    list.forEach(function (e) {
      var f = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "tool-results") walk(f, depth + 1);
      } else if (/\.jsonl$/.test(e.name)) {
        var st = fs.statSync(f);
        if (st.mtimeMs < cutoff) return;
        if (fs.readFileSync(f, "utf8").indexOf(nonce) >= 0) hits.push({ f: f, m: st.mtimeMs });
      }
    });
  })(base, 0);
  hits.sort(function (a, b) {
    return b.m - a.m;
  });
  return hits.map(function (h) {
    return h.f;
  });
}

var ASANA_CALLS = ["search_tasks", "get_projects", "get_users", "get_teams", "get_task"];

function resultText(c) {
  var cont = c.content;
  if (Array.isArray(cont))
    cont = cont
      .map(function (x) {
        return x && x.type === "text" ? x.text : "";
      })
      .join("");
  return String(cont == null ? "" : cont);
}

function parseResult(text) {
  var m = /Output has been saved to (\S+?\.(?:txt|json))[.\s]/.exec(text);
  if (m && fs.existsSync(m[1])) text = fs.readFileSync(m[1], "utf8");
  try {
    return JSON.parse(text);
  } catch (e) {
    return { _error: text.slice(0, 300) };
  }
}

function extractCalls(file, nonce) {
  var lines = fs.readFileSync(file, "utf8").split("\n");
  var started = false;
  var uses = {};
  var calls = [];
  lines.forEach(function (l) {
    if (!l) return;
    if (!started) {
      if (l.indexOf(nonce) >= 0) started = true;
      return;
    }
    var d;
    try {
      d = JSON.parse(l);
    } catch (e) {
      return;
    }
    var msg = d.message || {};
    if (!Array.isArray(msg.content)) return;
    msg.content.forEach(function (c) {
      if (c.type === "tool_use" && /^mcp__/.test(c.name || "")) {
        var short = c.name.split("__").pop();
        if (ASANA_CALLS.indexOf(short) >= 0 && !/ramp|shopify|vercel/i.test(c.name)) uses[c.id] = { name: short, input: c.input || {} };
      } else if (c.type === "tool_result" && uses[c.tool_use_id]) {
        var u = uses[c.tool_use_id];
        calls.push({ name: u.name, input: u.input, result: parseResult(resultText(c)) });
      }
    });
  });
  return calls;
}

function cmdExtract() {
  var dir = arg("dir");
  var nonce = fs.readFileSync(path.join(dir, "nonce.txt"), "utf8").trim();
  var files = arg("transcript") ? [arg("transcript")] : findTranscript(nonce);
  if (!files.length) {
    out({ step: "extract", ok: false, error: "no transcript under ~/.claude/projects contains the nonce " + nonce });
    process.exitCode = 1;
    return;
  }
  var calls = extractCalls(files[0], nonce);
  fs.writeFileSync(path.join(dir, "asana.json"), JSON.stringify({ transcript: files[0], calls: calls }));
  var by = {};
  var errors = 0;
  calls.forEach(function (c) {
    by[c.name] = (by[c.name] || 0) + 1;
    if (c.result && c.result._error) errors++;
  });
  out({ step: "extract", ok: errors === 0, transcript: files[0], calls: by, errors: errors });
  if (errors) process.exitCode = 1;
}

// ---------- context SQL (run with: npx supabase db query --linked --project-ref ... -f context.sql --output-format json) ----------
function contextSql(today) {
  return [
    "select json_build_object(",
    " 'switch', (select value from tk_settings where key = 'asana_import_apply_enabled'),",
    " 'clients', (select json_agg(json_build_object('id', c.id, 'name', c.name, 'bk', c.assigned_bookkeeper_email,",
    "    't', coalesce(c.test_only, false), 'i', coalesce(c.is_internal, false)) order by c.id) from clients c),",
    " 'staff', (select json_agg(json_build_object('email', lower(s.email), 'name', s.name, 'active', true) order by s.email)",
    "    from staff s where s.active),",
    // Which client each Asana project fed in earlier applied runs (aliases + a consistency check).
    " 'history', (select json_agg(json_build_object('sp', sp, 'c', c, 'n', n)) from (",
    "    select pr.payload ->> 'source_project_gid' sp, pr.payload ->> 'client_id' c, count(*) n",
    "      from tk_import_plan_rows pr join tk_import_runs r on r.id = pr.run_id",
    "     where r.status = 'applied' and pr.kind = 'task' and pr.payload ->> 'parent_gid' is null",
    "     group by 1, 2) h),",
    " 'keys', (select json_agg(k) from (",
    "    select 'asana:' || kind || ':' || asana_gid k from tk_asana_import_map",
    "    union select 'asana:task:' || source_ref from staff_reminders where source = 'asana' and source_ref is not null",
    "    union select 'asana:template:' || source_ref from task_templates where source = 'asana' and source_ref is not null) x),",
    // Open portal tasks, for the recurring-duplicate guard (same client + same title).
    " 'open', (select json_agg(json_build_object('c', client_id, 't', lower(regexp_replace(btrim(text), '\\s+', ' ', 'g')), 'src', source))",
    "    from staff_reminders where deleted_at is null and not coalesce(done, false) and (client_id is not null or source = 'asana')),",
    " 'templates', (select json_agg(json_build_object('c', client_ids, 'cad', cadence, 't', lower(regexp_replace(btrim(title), '\\s+', ' ', 'g'))))",
    "    from task_templates where coalesce(status, '') <> 'retired'),",
    " 'batches', (select json_agg(report ->> 'batch') from tk_import_runs where report ->> 'batch' like 'asana-daily-" + today + "%'),",
    " 'outbox', (select json_build_object('n', count(*), 'max_id', max(id)) from notification_outbox)",
    ") as ctx;",
  ].join("\n");
}

function cmdContextSql() {
  var dir = arg("dir");
  var today = runToday(dir);
  fs.writeFileSync(path.join(dir, "context.sql"), contextSql(today));
  out({ step: "context-sql", file: path.join(dir, "context.sql"), next: "npx supabase db query --linked --project-ref xumsqmhccgfjnlmieqyu -f context.sql --output-format json > context.json" });
}

function runToday(dir) {
  var f = path.join(dir, "run.json");
  return fs.existsSync(f) ? readJson(f).today : path.basename(dir).slice(0, 10);
}

function readCli(file) {
  var raw = fs.readFileSync(file, "utf8");
  var i = raw.indexOf("{");
  var j = JSON.parse(raw.slice(i));
  return j.rows ? j.rows : j;
}

// ---------- snapshot from the Asana calls ----------
function cf(t) {
  var o = {};
  (t.custom_fields || []).forEach(function (f) {
    if (f && f.display_value != null) o[f.name] = f.display_value;
  });
  return o;
}

function buildSnapshot(calls, snapshotAt) {
  var projects = {};
  var users = null;
  var teams = null;
  var found = {}; // gid -> task (search results and fetched parents)
  calls.forEach(function (c) {
    var d = c.result && c.result.data;
    if (c.name === "get_projects" && Array.isArray(d))
      d.forEach(function (p) {
        var tc = p.task_counts || {};
        projects[p.gid] = {
          gid: p.gid,
          name: p.name,
          team: (p.team || {}).name || null,
          archived: !!p.archived,
          created_at: p.created_at,
          modified_at: p.modified_at,
          open: tc.num_incomplete_tasks || 0,
        };
      });
    if (c.name === "get_users" && Array.isArray(d)) users = d;
    if (c.name === "get_teams" && Array.isArray(d)) teams = d;
    if (c.name === "search_tasks" && Array.isArray(d))
      d.forEach(function (t) {
        found[t.gid] = t;
      });
    if (c.name === "get_task" && d && d.gid) found[d.gid] = Object.assign({ _fetched: true }, d);
  });
  var tasks = [];
  var subtasks = [];
  var noProject = 0;
  var completed = 0;
  Object.keys(found).forEach(function (g) {
    var t = found[g];
    if (t.completed) {
      completed++;
      return;
    }
    var a = t.assignee || {};
    var parent = (t.parent || {}).gid || null;
    if (parent) {
      subtasks.push({ g: t.gid, par: parent, n: t.name, a: a.email, an: a.name, d: t.due_on, s: t.start_on, c: t.created_at, m: t.modified_at, ns: t.num_subtasks || 0, cf: cf(t), notes: t.notes || "" });
      return;
    }
    var ms = (t.memberships || []).filter(function (m) {
      return m && m.project && m.project.gid;
    });
    if (!ms.length) {
      noProject++;
      return;
    }
    ms.forEach(function (m) {
      tasks.push({ g: t.gid, p: m.project.gid, n: t.name, a: a.email, an: a.name, d: t.due_on, s: t.start_on, sec: (m.section || {}).name || null, cf: cf(t), par: null, c: t.created_at, m: t.modified_at, ns: t.num_subtasks || 0, mp: ms.length, notes: t.notes || "", _fetched: !!t._fetched });
    });
  });
  return {
    snapshot: { snapshot_at: snapshotAt, users: users || [], teams: teams || [], projects: Object.keys(projects).map(function (k) { return projects[k]; }), tasks: tasks, subtasks: subtasks },
    found: found,
    stats: { tasks: tasks.length, subtasks: subtasks.length, no_project: noProject, completed: completed, projects: Object.keys(projects).length, have_users: !!users, have_teams: !!teams },
  };
}

// ---------- plan ----------
// Pure: snapshot + db context -> what to stage, plus guards. Exported for the test.
function planDaily(snap, db, opts) {
  opts = opts || {};
  var errors = [];
  var pname = {};
  snap.projects.forEach(function (p) {
    pname[p.gid] = p.name;
  });
  // Aliases: the Asana project names that fed each client before (same as the Oct 21 run).
  var hist = {};
  var alias = {};
  (db.history || []).forEach(function (h) {
    if (!h.sp) return;
    (hist[h.sp] = hist[h.sp] || {})[h.c || ""] = true;
    if (h.c && pname[h.sp]) (alias[h.c] = alias[h.c] || {})[pname[h.sp].trim()] = true;
  });
  var clients = (db.clients || []).map(function (c) {
    var e = { id: c.id, name: c.name, assigned_bookkeeper_email: c.bk, test_only: c.t, is_internal: c.i };
    var al = Object.keys(alias[c.id] || {}).filter(function (a) {
      return a.toLowerCase() !== String(c.name).toLowerCase();
    }).sort();
    if (al.length) e.aliases = al;
    return e;
  });
  var real = clients.filter(function (c) {
    return !c.test_only && !c.is_internal;
  });
  var staff = db.staff || [];
  var decisions = opts.decisions || {};
  var ctx = {
    staff: staff,
    fallbackEmail: FALLBACK,
    today: opts.today,
    overrides: OVERRIDES,
    splits: decisions.split_projects || {},
    importedKeys: db.keys || [],
    userRemap: B.resolveRemap(decisions.user_remap, staff),
    clients: real,
  };
  var plan = P.AI_plan(snap, ctx);

  // Subtasks whose parent is not in the snapshot: the session must fetch the parent (get_task) first.
  var have = {};
  snap.tasks.forEach(function (t) {
    have[t.g] = true;
  });
  snap.subtasks.forEach(function (s) {
    have[s.g] = true;
  });
  var needParents = [];
  snap.subtasks.forEach(function (s) {
    if (!have[s.par] && needParents.indexOf(s.par) < 0 && (opts.fetched || []).indexOf(s.par) < 0) needParents.push(s.par);
  });

  var keySet = {};
  (db.keys || []).forEach(function (k) {
    keySet[k] = true;
  });
  var openSet = {};
  (db.open || []).forEach(function (o) {
    if (o.c) openSet[o.c + "|" + o.t] = true;
    else if (o.src === "asana") openSet["|" + o.t] = true;
  });
  var tplSet = {};
  (db.templates || []).forEach(function (x) {
    (x.c || [null]).forEach(function (c) {
      tplSet[(c || "") + "|" + x.cad + "|" + x.t] = true;
    });
  });

  var newTasks = plan.tasks.filter(function (t) {
    return !t.already_imported && !keySet["asana:task:" + t.asana_gid];
  });
  var heldBack = [];
  var stagedGids = {};
  var tasks = [];
  newTasks.forEach(function (t) {
    // A parent held back holds its subtasks back too.
    if (t.parent_gid && heldBack.some(function (h) { return h.asana_gid === t.parent_gid; })) {
      heldBack.push({ asana_gid: t.asana_gid, client_id: t.client_id, title: t.title, why: "parent_held_back" });
      return;
    }
    // A parent fetched only to place a new subtask is older than the window: never import it here.
    if ((opts.fetched || []).indexOf(t.asana_gid) >= 0) {
      heldBack.push({ asana_gid: t.asana_gid, client_id: t.client_id, title: t.title, why: "old_parent_not_imported" });
      return;
    }
    if (!t.parent_gid && openSet[(t.client_id || "") + "|" + norm(t.title)]) {
      heldBack.push({ asana_gid: t.asana_gid, client_id: t.client_id, title: t.title, why: "same_title_open_in_portal" });
      return;
    }
    // History check: an Asana project must keep feeding the same client as before.
    var h = hist[t.source_project_gid];
    if (!t.parent_gid && h && !h[t.client_id || ""]) {
      errors.push("client_changed: task " + t.asana_gid + " from project " + t.source_project_gid + " maps to " + (t.client_id || "(none)") + ", before " + Object.keys(h).join("/"));
    }
    stagedGids[t.asana_gid] = true;
    tasks.push(t);
  });
  var projects = plan.projects.filter(function (p) {
    return !p.already_imported && !keySet["asana:project:" + p.asana_gid] && tasks.some(function (t) {
      return t.project_gid === p.asana_gid || t.project_gid === "tracker:" + p.asana_gid;
    });
  });
  var templates = [];
  var heldTemplates = 0;
  plan.templates.forEach(function (x) {
    if (x.already_imported || keySet["asana:template:" + x.asana_gid]) return;
    if (!stagedGids[x.instance_gid || x.asana_gid]) return;
    if (!IMPORT_TEMPLATES || tplSet[(x.client_id || "") + "|" + x.cadence + "|" + norm(x.title)]) {
      heldTemplates++;
      return;
    }
    templates.push(x);
  });

  if (tasks.length > CAP_TASKS) errors.push("cap: " + tasks.length + " new tasks is over the daily cap of " + CAP_TASKS);
  if (projects.length > CAP_PROJECTS) errors.push("cap: " + projects.length + " new portal projects is over the cap of " + CAP_PROJECTS);
  var newProjectGids = snap.projects
    .filter(function (p) {
      return !hist[p.gid] && !p.archived;
    })
    .map(function (p) {
      return p.gid;
    });

  var counts = {
    new_tasks: tasks.length,
    new_subtasks: tasks.filter(function (t) { return !!t.parent_gid; }).length,
    unassigned: tasks.filter(function (t) { return !t.assignee_email; }).length,
    no_client: tasks.filter(function (t) { return !t.client_id; }).length,
    held_back: heldBack.length,
    already_imported: plan.tasks.length - newTasks.length,
    skipped_by_planner: plan.skipped.length,
    new_projects: projects.length,
    new_templates: templates.length,
    held_back_templates: heldTemplates,
  };
  return {
    plan: plan,
    tasks: tasks,
    projects: projects,
    templates: templates,
    heldBack: heldBack,
    needParents: needParents,
    errors: errors,
    counts: counts,
    skippedReasons: plan.report.skipped_by_reason || {},
    asanaProjectsWithoutHistory: newProjectGids.length,
  };
}

function stagePayload(r, snapshotAt) {
  function strip(row) {
    var o = {};
    Object.keys(row).forEach(function (k) {
      if (k !== "key" && k !== "asana_gid") o[k] = row[k];
    });
    return o;
  }
  var rows = [];
  r.projects.forEach(function (p) {
    rows.push({ kind: "project", asana_gid: p.asana_gid, payload: strip(p) });
  });
  r.tasks.forEach(function (t) {
    rows.push({ kind: "task", asana_gid: t.asana_gid, payload: strip(t) });
  });
  r.templates.forEach(function (t) {
    rows.push({ kind: "template", asana_gid: t.asana_gid, payload: strip(t) });
  });
  return rows;
}

function dollar(s) {
  var tag;
  do {
    tag = "$j" + crypto.randomBytes(4).toString("hex") + "$";
  } while (s.indexOf(tag) >= 0);
  return tag + s + tag;
}

function cmdPlan() {
  var dir = arg("dir");
  var today = runToday(dir);
  var asana = readJson(path.join(dir, "asana.json"));
  var db = readCli(path.join(dir, "context.json"))[0].ctx;
  var snapshotAt = new Date().toISOString();
  var built = buildSnapshot(asana.calls, snapshotAt);
  var fetched = asana.calls
    .filter(function (c) { return c.name === "get_task"; })
    .map(function (c) { return String(c.input.task_id); });
  var stop = [];
  if (!built.stats.have_users || !built.stats.have_teams || built.stats.projects < 50) stop.push("pull_incomplete: need get_projects (archived true and false), get_users, get_teams");
  var searches = asana.calls.filter(function (c) { return c.name === "search_tasks"; });
  if (!searches.length) stop.push("pull_incomplete: no search_tasks call");
  searches.forEach(function (c) {
    if (c.result._error || !Array.isArray(c.result.data)) stop.push("asana_error: " + JSON.stringify(c.result).slice(0, 200));
    if (c.input.completed !== false) stop.push("search_tasks must use completed=false");
  });
  // Paging: the last page must be short, or the pull missed tasks.
  var last = searches[searches.length - 1];
  if (last && Array.isArray(last.result.data) && last.result.data.length >= (last.input.limit || 50)) stop.push("need_more_pages: last search_tasks page was full; call again with created_at_after = the last created_at");
  if (db.switch === true) stop.push("switch_already_on: asana_import_apply_enabled was on before this run; left untouched");
  var decisions = readJson(path.join(__dirname, "owner-decisions.json"));
  var r = planDaily(built.snapshot, db, { today: today, decisions: decisions, fetched: fetched });
  var batch = "asana-daily-" + today;
  var used = db.batches || [];
  var n = 2;
  while (used.indexOf(batch) >= 0) batch = "asana-daily-" + today + "-" + n++;
  var summary = { step: "plan", today: today, batch: batch, pulled: built.stats, counts: r.counts, skipped_by_reason: r.skippedReasons, errors: r.errors.concat(stop), need_parents: r.needParents };
  var held = r.heldBack.map(function (h) { return { gid: h.asana_gid, client_id: h.client_id, title: h.title, why: h.why }; });
  fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify({ summary: summary, held_back: held, tasks: r.tasks, projects: r.projects, templates: r.templates, skipped: r.plan.skipped }, null, 1));
  var stagePath = path.join(dir, "stage.sql");
  if (fs.existsSync(stagePath)) fs.unlinkSync(stagePath);
  if (r.needParents.length) {
    summary.status = "need_parents";
    summary.next = "call get_task (include_comments=false, include_subtasks=false, opt_fields as in the runbook) for each need_parents gid, then extract and plan again";
  } else if (summary.errors.length) {
    summary.status = "stop";
  } else if (!r.tasks.length && !r.templates.length) {
    summary.status = "nothing_new";
  } else {
    summary.status = "ready";
    var report = Object.assign({ batch: batch, kind: "asana-daily", note: "Daily Asana import " + today + " (new open tasks only; same-title open portal tasks held back)", window_start: WINDOW_START }, r.counts);
    var rows = stagePayload(r, snapshotAt);
    fs.writeFileSync(
      stagePath,
      "select public.tk_import_asana_stage('" + snapshotAt + "'::timestamptz, " + dollar(JSON.stringify(report)) + "::jsonb, " + dollar(JSON.stringify(rows)) + "::jsonb) as run_id;\n"
    );
    summary.stage_rows = rows.length;
    summary.next = "npx supabase db query --linked --project-ref xumsqmhccgfjnlmieqyu -f stage.sql --output-format json > stage.json";
  }
  out(summary);
}

// ---------- apply + verify SQL ----------
function cmdApplySql() {
  var dir = arg("dir");
  var run = arg("run");
  if (!/^[0-9a-f-]{36}$/.test(run || "")) throw new Error("--run must be the staged run uuid");
  var conf = "IMPORT " + run.slice(0, 8);
  // One transaction: switch on, apply, switch off. Any error rolls all of it back, so the
  // switch can never be left on. verify.sql then reads it back.
  var apply = [
    "do $$",
    "begin",
    "  if (select status from tk_import_runs where id = '" + run + "') <> 'planned' then raise exception 'run not planned'; end if;",
    "  if coalesce((select value from tk_settings where key = 'asana_import_apply_enabled'), 'false'::jsonb) = 'true'::jsonb then",
    "    raise exception 'switch was already on: not touching it';",
    "  end if;",
    "  perform set_config('mgb.tk_owner_override', 'on', true);",
    "  update tk_settings set value = 'true'::jsonb where key = 'asana_import_apply_enabled';",
    "  perform public.tk_import_asana_apply('" + run + "'::uuid, '" + conf + "', '" + FALLBACK + "');",
    "  update tk_settings set value = 'false'::jsonb where key = 'asana_import_apply_enabled';",
    "  perform set_config('mgb.tk_owner_override', '', true);",
    "end $$;",
  ].join("\n");
  var verify = [
    "select json_build_object(",
    " 'switch', (select value from tk_settings where key = 'asana_import_apply_enabled'),",
    " 'run', (select json_build_object('id', id, 'status', status, 'batch', report ->> 'batch', 'result', result - 'skips', 'skips', jsonb_array_length(coalesce(result -> 'skips', '[]'::jsonb)), 'applied_at', applied_at) from tk_import_runs where id = '" + run + "'),",
    " 'dup_source_refs', (select count(*) from (select source_ref from staff_reminders where source = 'asana' and deleted_at is null group by source_ref having count(*) > 1) d),",
    " 'outbox', (select json_build_object('n', count(*), 'max_id', max(id)) from notification_outbox)",
    ") as v;",
  ].join("\n");
  fs.writeFileSync(path.join(dir, "apply.sql"), apply + "\n");
  fs.writeFileSync(path.join(dir, "verify.sql"), verify + "\n");
  out({ step: "apply-sql", apply: path.join(dir, "apply.sql"), verify: path.join(dir, "verify.sql") });
}

// ---------- finish: one log line ----------
function cmdFinish() {
  var dir = arg("dir");
  var root = path.dirname(dir);
  var plan = fs.existsSync(path.join(dir, "plan.json")) ? readJson(path.join(dir, "plan.json")).summary : null;
  var v = null;
  if (arg("verify") && fs.existsSync(arg("verify"))) v = readCli(arg("verify"))[0].v;
  var ctxFile = path.join(dir, "context.json");
  var before = fs.existsSync(ctxFile) ? readCli(ctxFile)[0].ctx.outbox : null;
  var c = (plan && plan.counts) || {};
  var res = (v && v.run && v.run.result) || {};
  var parts = [
    new Date().toISOString(),
    plan ? plan.batch : path.basename(dir),
    "status=" + (v && v.run ? v.run.status : plan ? plan.status : "no_plan"),
    "new=" + (res.tasks_created != null ? res.tasks_created : 0),
    "planned=" + (c.new_tasks || 0),
    "skipped=" + ((c.already_imported || 0) + (c.skipped_by_planner || 0) + (res.skipped || 0)),
    "held_back=" + (c.held_back || 0),
    "unassigned=" + (res.tasks_unassigned != null ? res.tasks_unassigned : c.unassigned || 0),
    "templates=" + (res.templates_created || 0),
    "errors=" + (plan ? plan.errors.length : 0),
    "switch=" + (v ? JSON.stringify(v.switch) : "n/a"),
    "dup_refs=" + (v ? v.dup_source_refs : "n/a"),
    "outbox_new=" + (v && before ? v.outbox.n - before.n : "n/a"),
    "run=" + (v && v.run ? v.run.id : arg("run") || "-"),
  ];
  if (arg("note")) parts.push("note=" + String(arg("note")).replace(/\s+/g, " ").slice(0, 200));
  if (plan && plan.errors.length) parts.push("why=" + plan.errors.join("; ").replace(/\s+/g, " ").slice(0, 300));
  var line = parts.join(" | ");
  fs.mkdirSync(root, { recursive: true });
  fs.appendFileSync(path.join(root, LOG_FILE), line + "\n");
  var ok = !v || (v.switch === false && v.dup_source_refs === 0);
  out({ step: "finish", ok: ok, log: path.join(root, LOG_FILE), line: line });
  if (!ok) process.exitCode = 1;
}

if (require.main === module) {
  var cmd = process.argv[2];
  var fn = { start: cmdStart, extract: cmdExtract, "context-sql": cmdContextSql, plan: cmdPlan, "apply-sql": cmdApplySql, finish: cmdFinish }[cmd];
  if (!fn) {
    console.error("usage: node dailyImport.js start|extract|context-sql|plan|apply-sql|finish [--dir D] [--run uuid]");
    process.exit(2);
  }
  fn();
}

module.exports = { planDaily: planDaily, buildSnapshot: buildSnapshot, extractCalls: extractCalls, contextSql: contextSql, STOP_DATE: STOP_DATE, CAP_TASKS: CAP_TASKS };
