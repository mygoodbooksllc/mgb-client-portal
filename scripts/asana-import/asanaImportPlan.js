// Tasks Phase 2, S8: one-time import of OPEN Asana tasks, the planner.
//
// Pure functions: no network, no Supabase, no file system. It takes an Asana
// snapshot (projects, sections, open tasks, open subtasks, users, teams) plus
// the portal's staff and clients, and returns the plan: which tk_projects rows,
// staff_reminders rows and draft task_templates rows an apply would create,
// what it would skip and why, and the dry-run report.
//
// Owner decisions (spec OD7): OPEN tasks only, no completed history. Asana
// users with no staff row go to the fallback address (passed in, never
// hard-coded). Duplicate onboarding projects merge and the newest wins. We
// never create clients: a project whose client is not in `clients` is skipped
// and listed. Nothing here writes anywhere; supabase/tasks-p2-8-asana-import.sql
// applies a staged plan, and only when the owner turns it on.
//
// Idempotency: every planned row carries `key` = "asana:<kind>:<gid>". The
// apply RPC records each key in tk_asana_import_map with the run (batch) id,
// skips keys already there, and undo uses the same map to roll a run back.
//
// Node test: `node scripts/asana-import/asanaImportPlan.test.js`.

var AI_INTERNAL_NAMES = ["directors tasks", "coo sop", "am sop", "owners tasks", "coo tasks", "90 day", "send reports"];
var AI_INTERNAL_TEAMS = ["directors", "owners"];
var AI_STOP = ["the", "church", "of", "a", "an", "and", "inc", "llc", "co", "ministries", "ministry"];
var AI_SUFFIX = ["onboarding", "monthly", "bookkeeping", "client"];
var AI_CADENCE = [
  [/\bweekly\b/i, "weekly"],
  [/\bmonthly\b/i, "monthly"],
  [/\bquarterly\b/i, "quarterly"],
  [/\b(annual|annually|yearly)\b/i, "annually"],
];
var AI_STATUS = {
  "not started": "todo",
  "to do": "todo",
  "in progress": "in_progress",
  "waiting on client": "waiting_client",
  "waiting": "waiting_client",
  "incomplete": "todo",
};
var AI_DONE_WORDS = ["done", "complete", "completed"];
var AI_REVIEW_STEP = /\b(email|send)\b.*\breports?\b.*\breview\b|\breview\b.*\breports?\b/i;
var AI_NO_SECTION = /^(untitled section|\(no section\)|no section)$/i;
var AI_DAY = 86400000;

function AI_key(kind, gid) {
  return "asana:" + kind + ":" + gid;
}

function AI_clean(s) {
  return String(s == null ? "" : s)
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// "Collective Church Onboarding " -> "collective church"; "Manna Church - Client" -> "manna church"
function AI_normName(s) {
  var t = AI_clean(s)
    .toLowerCase()
    .replace(/'s\b/g, "s")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (t.length > 1 && AI_SUFFIX.indexOf(t[t.length - 1]) >= 0) t.pop();
  return t.join(" ");
}

// The words that identify a client: "Golden City Church" and "Golden City" both give "golden city".
function AI_coreName(s) {
  var t = AI_normName(s).split(" ").filter(function (w) {
    return w && AI_STOP.indexOf(w) < 0;
  });
  return t.length ? t.join(" ") : AI_normName(s);
}

function AI_slug(s) {
  return AI_normName(s).replace(/ /g, "-").slice(0, 60);
}

function AI_isOnboardingName(name) {
  return /\bonboarding\b/i.test(name || "");
}

function AI_lower(e) {
  return e ? String(e).trim().toLowerCase() : null;
}

function AI_dateOk(d) {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + "T00:00:00Z"));
}

function AI_dayDiff(a, b) {
  return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / AI_DAY);
}

function AI_weekday(d) {
  return new Date(Date.parse(d + "T00:00:00Z")).getUTCDay();
}

// Best client for a project name. Returns {client_id, confidence, candidates}.
function AI_matchClient(name, clients) {
  var core = AI_coreName(name);
  var norm = AI_normName(name);
  var high = [];
  var medium = [];
  (clients || []).forEach(function (c) {
    var cCore = AI_coreName(c.name);
    if (c.id === AI_slug(name) || AI_normName(c.name) === norm || (cCore && cCore === core)) {
      high.push(c.id);
      return;
    }
    var a = core.split(" ");
    var b = cCore.split(" ");
    var shared = a.filter(function (w) {
      return b.indexOf(w) >= 0;
    });
    var small = a.length <= b.length ? a : b;
    if (shared.length === small.length && (shared.length >= 2 || (shared[0] || "").length >= 5)) medium.push(c.id);
  });
  if (high.length === 1) return { client_id: high[0], confidence: "high", candidates: high };
  if (high.length > 1) return { client_id: null, confidence: "ambiguous", candidates: high };
  if (medium.length === 1) return { client_id: medium[0], confidence: "medium", candidates: medium };
  if (medium.length > 1) return { client_id: null, confidence: "ambiguous", candidates: medium };
  return { client_id: null, confidence: "none", candidates: [] };
}

// "Nicole's Clients" -> the staff row whose first name is Nicole.
function AI_teamBookkeeper(teamName, staff) {
  var m = /^\s*([A-Za-z]+)['’]s clients\s*$/i.exec(teamName || "");
  if (!m) return null;
  var first = m[1].toLowerCase();
  var hit = (staff || []).filter(function (s) {
    return s.active !== false && String(s.name || "").trim().split(/\s+/)[0].toLowerCase() === first;
  });
  return hit.length === 1 ? AI_lower(hit[0].email) : null;
}

function AI_teamFirstNames(teams) {
  return (teams || [])
    .map(function (t) {
      var m = /^\s*([A-Za-z]+)['’]s clients\s*$/i.exec(t.name || "");
      return m ? m[1].toLowerCase() : null;
    })
    .filter(Boolean);
}

// Step 1: what each Asana project becomes. Owner overrides win:
// overrides[gid] = {target_kind, client_id, note}.
function AI_classifyProject(p, ctx) {
  var name = AI_clean(p.name);
  var norm = AI_normName(name);
  var team = p.team || null;
  var o = (ctx.overrides || {})[p.gid];
  var out = {
    gid: p.gid,
    name: name,
    team: team,
    archived: !!p.archived,
    modified_at: p.modified_at || null,
    created_at: p.created_at || null,
    norm: norm,
    target_kind: null,
    client_id: null,
    confidence: null,
    suggested_client_id: null,
    candidates: [],
    reason: null,
  };
  if (o && o.target_kind) {
    out.target_kind = o.target_kind;
    out.client_id = o.client_id || null;
    out.confidence = "owner";
    out.reason = o.note || "owner override";
    if ((out.target_kind === "client" || out.target_kind === "onboarding") && out.client_id) {
      var known = (ctx.clients || []).some(function (c) {
        return c.id === out.client_id;
      });
      if (!known) {
        out.reason = "override client not in clients";
        out.client_id = null;
      }
    }
    return out;
  }
  if (/\btemplate\b/i.test(name)) {
    out.target_kind = "skip";
    out.confidence = "high";
    out.reason = "template_project";
    return out;
  }
  if (/^new client onboarding$/i.test(name)) {
    out.target_kind = "tracker";
    out.confidence = "high";
    out.reason = "each section is a client's onboarding";
    return out;
  }
  if (AI_INTERNAL_NAMES.indexOf(norm) >= 0) {
    out.target_kind = "internal";
    out.confidence = "high";
    return out;
  }
  if (team && AI_INTERNAL_TEAMS.indexOf(String(team).toLowerCase()) >= 0) {
    out.target_kind = "internal";
    out.confidence = "medium";
    out.reason = "team " + team;
    return out;
  }
  if (AI_isOnboardingName(name)) {
    var core = AI_coreName(name);
    var staffFirst = (ctx.staff || []).map(function (s) {
      return String(s.name || "").trim().split(/\s+/)[0].toLowerCase();
    });
    if (core.split(" ").length === 1 && (AI_teamFirstNames(ctx.teams).indexOf(core) >= 0 || staffFirst.indexOf(core) >= 0)) {
      out.target_kind = "internal";
      out.confidence = "low";
      out.reason = "looks like a staff member's onboarding";
      return out;
    }
    out.target_kind = "onboarding";
  } else {
    out.target_kind = "client";
  }
  var m = AI_matchClient(name, ctx.clients);
  out.client_id = m.client_id;
  out.confidence = m.confidence;
  out.candidates = m.candidates;
  out.suggested_client_id = m.client_id || AI_slug(AI_coreName(name) === AI_normName(name) ? name : name);
  if (!m.client_id) out.reason = m.confidence === "ambiguous" ? "client_ambiguous" : "client_missing";
  return out;
}

// Newest wins: live projects beat archived ones, then the latest modified_at, then created_at.
function AI_pickWinner(list) {
  return list.slice().sort(function (a, b) {
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    var am = a.modified_at || "";
    var bm = b.modified_at || "";
    if (am !== bm) return am < bm ? 1 : -1;
    var ac = a.created_at || "";
    var bc = b.created_at || "";
    if (ac !== bc) return ac < bc ? 1 : -1;
    return a.gid < b.gid ? 1 : -1;
  })[0];
}

function AI_taskTitleKey(t) {
  return AI_clean(t.n).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + "|" + AI_clean(t.sec || "").toLowerCase();
}

function AI_status(cf) {
  var raw = null;
  Object.keys(cf || {}).forEach(function (k) {
    if (/progress|status/i.test(k) && cf[k] != null) raw = String(cf[k]);
  });
  if (raw == null) return { status: "todo", raw: null, known: true };
  var s = AI_STATUS[raw.trim().toLowerCase()];
  if (s) return { status: s, raw: raw, known: true };
  // An open task whose progress field says Done: keep it open, flag it.
  return { status: "todo", raw: raw, known: false, says_done: AI_DONE_WORDS.indexOf(raw.trim().toLowerCase()) >= 0 };
}

function AI_priority(cf) {
  var raw = null;
  Object.keys(cf || {}).forEach(function (k) {
    if (/priority/i.test(k) && cf[k] != null) raw = String(cf[k]).toLowerCase();
  });
  if (!raw) return "normal";
  if (/high|urgent/.test(raw)) return "high";
  if (/low/.test(raw)) return "low";
  return "normal";
}

function AI_cadence(section) {
  for (var i = 0; i < AI_CADENCE.length; i++) if (AI_CADENCE[i][0].test(section || "")) return AI_CADENCE[i][1];
  return null;
}

function AI_permalink(projectGid, gid) {
  return "https://app.asana.com/0/" + (projectGid || "0") + "/" + gid;
}

function AI_truncate(s, n) {
  s = AI_clean(s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// The whole plan. snapshot = {snapshot_at, users, teams, projects, tasks, subtasks}
// tasks: compact rows {g, p, n, a, an, d, s, sec, cf, par, c, m, ns, notes?}
// subtasks: {g, par, n, a, an, d, s, c, m, notes?}
// ctx = {staff:[{email,name,active}], clients:[{id,name,assigned_bookkeeper_email,test_only}],
//        fallbackEmail, today:'YYYY-MM-DD', overrides:{gid:{target_kind,client_id}},
//        importedKeys:[...] (keys already in tk_asana_import_map), unionArchivedLosers:false}
function AI_plan(snapshot, ctx) {
  ctx = ctx || {};
  var fallback = AI_lower(ctx.fallbackEmail);
  if (!fallback) throw new Error("fallbackEmail is required");
  var today = ctx.today;
  if (!AI_dateOk(today)) throw new Error("today must be YYYY-MM-DD");
  var imported = {};
  (ctx.importedKeys || []).forEach(function (k) {
    imported[k] = true;
  });
  var staffByEmail = {};
  (ctx.staff || []).forEach(function (s) {
    staffByEmail[AI_lower(s.email)] = s;
  });
  if (!staffByEmail[fallback] || staffByEmail[fallback].active === false) throw new Error("fallbackEmail must be active staff");
  var clientById = {};
  (ctx.clients || []).forEach(function (c) {
    clientById[c.id] = c;
  });

  var warnings = [];
  var skipped = [];
  var anomalies = [];

  // 1. Projects
  var projects = (snapshot.projects || []).map(function (p) {
    return AI_classifyProject(p, { clients: ctx.clients, staff: ctx.staff, teams: snapshot.teams, overrides: ctx.overrides });
  });
  var projByGid = {};
  projects.forEach(function (p) {
    projByGid[p.gid] = p;
  });

  // 2. Duplicates: same target and same normalized name. Newest wins; both gids map to the winner.
  var groups = {};
  projects.forEach(function (p) {
    if (p.target_kind === "skip" || p.target_kind === "tracker") return;
    var k = p.target_kind + "|" + p.norm;
    (groups[k] = groups[k] || []).push(p);
  });
  var duplicates = [];
  Object.keys(groups).forEach(function (k) {
    var list = groups[k];
    if (list.length < 2) return;
    var win = AI_pickWinner(list);
    list.forEach(function (p) {
      p.merged_into = p.gid === win.gid ? null : win.gid;
      if (p.gid !== win.gid && p.client_id == null && win.client_id != null) p.client_id = win.client_id;
    });
    duplicates.push({
      normalized_name: list[0].norm,
      target_kind: list[0].target_kind,
      gids: list.map(function (p) {
        return p.gid;
      }),
      archived_gids: list
        .filter(function (p) {
          return p.archived;
        })
        .map(function (p) {
          return p.gid;
        }),
      winner_gid: win.gid,
      winner_modified_at: win.modified_at,
      tasks_merged: 0,
      tasks_dropped: 0,
      tasks_dropped_archived: 0,
    });
  });
  var dupByWinner = {};
  duplicates.forEach(function (d) {
    dupByWinner[d.winner_gid] = d;
  });
  // Archived projects that did not lose a merge are skipped whole.
  projects.forEach(function (p) {
    if (p.archived && !p.merged_into && p.target_kind !== "skip") {
      p.target_kind = "skip";
      p.reason = "archived";
    }
  });
  function finalProject(gid) {
    var p = projByGid[gid];
    while (p && p.merged_into) p = projByGid[p.merged_into];
    return p || null;
  }

  // 3. Users
  var asanaUsers = {};
  (snapshot.users || []).forEach(function (u) {
    asanaUsers[AI_lower(u.email) || "gid:" + u.gid] = u;
  });
  var userStats = {};
  function mapUser(email, name) {
    var e = AI_lower(email);
    var k = e || (name ? "name:" + name : "unassigned");
    var st = (userStats[k] = userStats[k] || {
      asana_email: e,
      asana_name: name || null,
      mapped_to: null,
      how: null,
      open_tasks: 0,
    });
    if (e && staffByEmail[e]) {
      st.mapped_to = e;
      st.how = staffByEmail[e].active === false ? "inactive_staff" : "email";
    } else if (e || name) {
      st.mapped_to = fallback;
      st.how = "fallback";
    } else {
      st.how = "unassigned";
    }
    return st;
  }

  // 4. Tasks: pick each gid once (a task can live in several projects)
  var seen = {};
  var rows = [];
  var tasks = (snapshot.tasks || []).slice();
  var winnerTitleKeys = {};
  var multiHomed = 0;

  function skip(gid, projectGid, reason, extra) {
    var r = { gid: gid, project_gid: projectGid || null, reason: reason };
    if (extra) Object.keys(extra).forEach(function (k) {
      r[k] = extra[k];
    });
    skipped.push(r);
  }

  // Order: tasks of merge winners before losers (title dedupe keeps the winner's copy), then
  // client projects first (a task in several projects lands on its client), newest first.
  function rank(t) {
    var p = projByGid[t.p] || {};
    return [p.merged_into ? 1 : 0, p.target_kind === "client" ? 0 : p.target_kind === "skip" ? 2 : 1];
  }
  tasks.sort(function (a, b) {
    var ra = rank(a);
    var rb = rank(b);
    if (ra[0] !== rb[0]) return ra[0] - rb[0];
    if (ra[1] !== rb[1]) return ra[1] - rb[1];
    var ma = a.m || "";
    var mb = b.m || "";
    if (ma !== mb) return ma < mb ? 1 : -1;
    return a.g < b.g ? -1 : a.g > b.g ? 1 : 0;
  });

  tasks.forEach(function (t) {
    if (t.completed === true) {
      skip(t.g, t.p, "completed");
      return;
    }
    if (seen[t.g]) {
      multiHomed++;
      return;
    }
    seen[t.g] = true;
    var src = projByGid[t.p];
    if (!src) {
      skip(t.g, t.p, "project_not_in_snapshot");
      return;
    }
    var proj = finalProject(t.p);
    if (src.merged_into) {
      var d = dupByWinner[proj.gid];
      if (src.archived && !ctx.unionArchivedLosers) {
        if (d) d.tasks_dropped_archived++;
        skip(t.g, t.p, "archived_duplicate_project");
        return;
      }
      var tk = proj.gid + "|" + AI_taskTitleKey(t);
      if (winnerTitleKeys[tk]) {
        if (d) d.tasks_dropped++;
        skip(t.g, t.p, "duplicate_in_merged_project", { kept_gid: winnerTitleKeys[tk] });
        return;
      }
      if (d) d.tasks_merged++;
    }
    var titleKey = proj.gid + "|" + AI_taskTitleKey(t);
    if (!winnerTitleKeys[titleKey]) winnerTitleKeys[titleKey] = t.g;

    if (proj.target_kind === "skip") {
      skip(t.g, t.p, "project_" + (proj.reason || "skipped"));
      return;
    }
    var clientId = null;
    var projectGid = null;
    var kind = proj.target_kind;
    if (kind === "tracker") {
      var m = AI_matchClient(t.sec || "", ctx.clients);
      if (!m.client_id) {
        skip(t.g, t.p, "tracker_client_missing", { section: t.sec || null });
        return;
      }
      clientId = m.client_id;
      projectGid = "tracker:" + t.p + ":" + AI_slug(t.sec);
    } else if (kind === "client") {
      if (!proj.client_id) {
        skip(t.g, t.p, proj.reason || "client_missing");
        return;
      }
      clientId = proj.client_id;
    } else if (kind === "onboarding") {
      if (!proj.client_id) {
        skip(t.g, t.p, "onboarding_" + (proj.reason || "client_missing"));
        return;
      }
      clientId = proj.client_id;
      projectGid = proj.gid;
    } else if (kind === "internal") {
      projectGid = proj.gid;
    }
    var title = AI_clean(t.n);
    if (!title) {
      skip(t.g, t.p, "empty_title");
      return;
    }
    rows.push(AI_taskRow(t, null, { proj: proj, src: src, clientId: clientId, projectGid: projectGid }));
  });

  // 5. Subtasks: open ones under an imported parent; deeper levels flatten to the top imported ancestor.
  var rowByGid = {};
  rows.forEach(function (r) {
    rowByGid[r.asana_gid] = r;
  });
  var subs = (snapshot.subtasks || []).slice();
  var subByGid = {};
  subs.forEach(function (s) {
    subByGid[s.g] = s;
  });
  var subtaskCount = 0;
  subs
    .sort(function (a, b) {
      return a.g < b.g ? -1 : a.g > b.g ? 1 : 0;
    })
    .forEach(function (s) {
      if (s.completed === true || seen[s.g]) return;
      var top = s.par;
      var depth = 1;
      var guard = 0;
      while (!rowByGid[top] && subByGid[top] && guard++ < 10) {
        top = subByGid[top].par;
        depth++;
      }
      var parent = rowByGid[top];
      if (!parent || parent.parent_gid) {
        skip(s.g, null, "parent_not_imported", { parent_gid: s.par });
        return;
      }
      if (!AI_clean(s.n)) {
        skip(s.g, null, "empty_title");
        return;
      }
      seen[s.g] = true;
      subtaskCount++;
      rows.push(
        AI_taskRow(s, parent, {
          proj: { gid: parent.project_gid_src },
          src: { gid: parent.project_gid_src },
          clientId: parent.client_id,
          projectGid: parent.project_gid,
          flattened: depth > 1,
        })
      );
    });

  // 6. Owners, status, dates, anomalies, idempotency
  rows.forEach(function (r) {
    var u = mapUser(r._a, r._an);
    var owner = u.mapped_to;
    var ownerHow = u.how;
    if (!owner) {
      // unassigned: the client's bookkeeper, else the team's bookkeeper, else the fallback
      var c = r.client_id ? clientById[r.client_id] : null;
      var tb = AI_teamBookkeeper(r._team, ctx.staff);
      if (c && c.assigned_bookkeeper_email && staffByEmail[AI_lower(c.assigned_bookkeeper_email)]) {
        owner = AI_lower(c.assigned_bookkeeper_email);
        ownerHow = "unassigned_client_bookkeeper";
      } else if (tb) {
        owner = tb;
        ownerHow = "unassigned_team_bookkeeper";
      } else {
        owner = fallback;
        ownerHow = "unassigned_fallback";
      }
    }
    u.open_tasks++;
    r.assignee_email = owner;
    r.staff_email = owner;
    r.owner_how = ownerHow;
    if (ownerHow === "fallback" && r._an) r.description_footer.push("Asana assignee: " + r._an);
    if (ownerHow === "unassigned_fallback" || ownerHow === "unassigned_team_bookkeeper" || ownerHow === "unassigned_client_bookkeeper")
      r.description_footer.push("Unassigned in Asana");

    if (r.due_date && !AI_dateOk(r.due_date)) {
      anomalies.push({ gid: r.asana_gid, kind: "bad_due_date", value: r.due_date });
      r.due_date = null;
    }
    if (r.start_on && !AI_dateOk(r.start_on)) {
      anomalies.push({ gid: r.asana_gid, kind: "bad_start_date", value: r.start_on });
      r.start_on = null;
    }
    if (r.due_date && r.start_on && r.start_on > r.due_date) {
      anomalies.push({ gid: r.asana_gid, kind: "start_after_due", value: r.start_on + " > " + r.due_date });
      r.start_on = null;
    }
    if (r.due_date) {
      var late = AI_dayDiff(today, r.due_date);
      if (late > 60) anomalies.push({ gid: r.asana_gid, kind: "overdue_over_60_days", value: r.due_date });
      if (late < -365) anomalies.push({ gid: r.asana_gid, kind: "due_over_a_year_out", value: r.due_date });
      var wd = AI_weekday(r.due_date);
      if (wd === 0 || wd === 6) anomalies.push({ gid: r.asana_gid, kind: "due_on_weekend", value: r.due_date });
    } else {
      anomalies.push({ gid: r.asana_gid, kind: "no_due_date", value: null });
    }
    if (!r.status_known) r.description_footer.push("Asana progress: " + r.status_raw);
    if (r.says_done) anomalies.push({ gid: r.asana_gid, kind: "open_but_progress_says_done", value: r.status_raw });
    r.description = AI_description(r._notes, r.description_footer, r._permalink);
    r.already_imported = !!imported[r.key];
  });

  // 7. Projects to create (onboarding with a client, internal), tracker sections, members
  var projectRows = [];
  var trackerRows = {};
  rows.forEach(function (r) {
    if (r.project_gid && r.project_gid.indexOf("tracker:") === 0 && !trackerRows[r.project_gid]) {
      trackerRows[r.project_gid] = {
        key: AI_key("project", r.project_gid.slice(8)),
        asana_gid: r.project_gid.slice(8),
        name: AI_truncate((clientById[r.client_id] || {}).name || r.section || "Onboarding", 100) + " onboarding",
        kind: "onboarding",
        client_id: r.client_id,
        sections: [],
        members: [],
        merged_gids: [],
        source: "tracker",
      };
    }
  });
  projects.forEach(function (p) {
    if (p.merged_into) return;
    if (p.target_kind !== "internal" && !(p.target_kind === "onboarding" && p.client_id)) return;
    var mine = rows.filter(function (r) {
      return r.project_gid === p.gid;
    });
    if (!mine.length) return;
    projectRows.push({
      key: AI_key("project", p.gid),
      asana_gid: p.gid,
      name: AI_truncate(p.name, 120),
      kind: p.target_kind,
      client_id: p.target_kind === "onboarding" ? p.client_id : null,
      sections: [],
      members: [],
      merged_gids: projects
        .filter(function (q) {
          return q.merged_into === p.gid;
        })
        .map(function (q) {
          return q.gid;
        }),
    });
  });
  Object.keys(trackerRows).forEach(function (k) {
    projectRows.push(trackerRows[k]);
  });
  projectRows.forEach(function (pr) {
    var gidRef = pr.source === "tracker" ? "tracker:" + pr.asana_gid : pr.asana_gid;
    var mine = rows.filter(function (r) {
      return r.project_gid === gidRef;
    });
    var secs = [];
    var mem = [];
    mine.forEach(function (r) {
      if (r.section && secs.indexOf(r.section) < 0 && secs.length < 30) secs.push(r.section);
      if (r.assignee_email && mem.indexOf(r.assignee_email) < 0 && staffByEmail[r.assignee_email] && staffByEmail[r.assignee_email].active !== false)
        mem.push(r.assignee_email);
    });
    pr.sections = secs;
    pr.members = mem.sort();
    pr.owner_email = mem[0] || fallback;
    pr.open_tasks = mine.length;
    pr.already_imported = !!imported[pr.key];
    if (pr.source === "tracker") pr.asana_gid = pr.asana_gid; // "<tracker gid>:<section slug>"
  });

  // 8. Draft recurring templates: open tasks in Weekly/Monthly/Quarterly/Annual sections of client projects
  var templates = [];
  var tplSeen = {};
  rows.forEach(function (r) {
    if (r.parent_gid || !r.client_id || r.project_gid) return;
    var cad = AI_cadence(r.section);
    if (!cad) return;
    var k = r.client_id + "|" + cad + "|" + AI_clean(r.title).toLowerCase();
    if (tplSeen[k]) return;
    tplSeen[k] = true;
    var checklist = rows
      .filter(function (s) {
        return s.parent_gid === r.asana_gid;
      })
      .map(function (s) {
        return AI_truncate(s.title, 200);
      })
      .slice(0, 50);
    templates.push({
      key: AI_key("template", r.asana_gid),
      asana_gid: r.asana_gid,
      title: AI_truncate(r.title, 200),
      cadence: cad,
      client_id: r.client_id,
      checklist: checklist,
      already_imported: !!imported[AI_key("template", r.asana_gid)],
    });
  });

  // 9. Strip private fields, order parents first
  var taskRows = rows
    .map(function (r) {
      return {
        key: r.key,
        asana_gid: r.asana_gid,
        parent_gid: r.parent_gid,
        project_gid: r.project_gid,
        source_project_gid: r.project_gid_src,
        client_id: r.client_id,
        title: r.title,
        description: r.description,
        due_date: r.due_date,
        start_on: r.start_on,
        section: r.section,
        status: r.status,
        priority: r.priority,
        visibility: r.client_id || r.project_gid ? "shared" : "private",
        assignee_email: r.assignee_email,
        staff_email: r.staff_email,
        owner_how: r.owner_how,
        review_step: r.review_step,
        flattened: r.flattened,
        already_imported: r.already_imported,
      };
    })
    .sort(function (a, b) {
      var pa = a.parent_gid ? 1 : 0;
      var pb = b.parent_gid ? 1 : 0;
      if (pa !== pb) return pa - pb;
      return a.asana_gid < b.asana_gid ? -1 : a.asana_gid > b.asana_gid ? 1 : 0;
    });

  var report = AI_report({
    snapshot: snapshot,
    projects: projects,
    duplicates: duplicates,
    taskRows: taskRows,
    projectRows: projectRows,
    templates: templates,
    skipped: skipped,
    anomalies: anomalies,
    userStats: userStats,
    multiHomed: multiHomed,
    subtaskCount: subtaskCount,
    warnings: warnings,
    fallback: fallback,
    staffByEmail: staffByEmail,
  });
  return { projects: projectRows, tasks: taskRows, templates: templates, skipped: skipped, project_map: projects, report: report };
}

function AI_taskRow(t, parent, o) {
  var st = AI_status(t.cf);
  var sec = AI_clean(t.sec || (parent ? parent.section : "") || "");
  if (AI_NO_SECTION.test(sec)) sec = "";
  return {
    key: AI_key("task", t.g),
    asana_gid: t.g,
    parent_gid: parent ? parent.asana_gid : null,
    project_gid: o.projectGid,
    project_gid_src: parent ? parent.project_gid_src : t.p,
    client_id: o.clientId,
    title: AI_truncate(t.n, 200),
    due_date: t.d || null,
    start_on: t.s || null,
    section: sec ? AI_truncate(sec, 60) : null,
    status: st.status,
    status_raw: st.raw,
    status_known: st.known,
    says_done: !!st.says_done,
    priority: AI_priority(t.cf),
    review_step: AI_REVIEW_STEP.test(t.n || ""),
    flattened: !!o.flattened,
    description_footer: AI_clean(t.n).length > 200 ? ["Full Asana title: " + AI_clean(t.n)] : [],
    _a: t.a || null,
    _an: t.an || null,
    _team: (o.proj && o.proj.team) || (o.src && o.src.team) || null,
    _notes: t.notes || null,
    _permalink: AI_permalink(parent ? parent.project_gid_src : t.p, t.g),
  };
}

function AI_description(notes, footer, permalink) {
  var tail = footer.concat(["Imported from Asana: " + permalink]).join("\n");
  var body = notes ? String(notes).trim() : "";
  var room = 5000 - tail.length - 2;
  if (body.length > room) body = body.slice(0, Math.max(0, room - 1)) + "…";
  return body ? body + "\n\n" + tail : tail;
}

function AI_count(list, fn) {
  var out = {};
  list.forEach(function (x) {
    var k = fn(x);
    if (k == null) return;
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}

function AI_report(x) {
  var create = x.taskRows.filter(function (r) {
    return !r.already_imported;
  });
  var users = Object.keys(x.userStats).map(function (k) {
    return x.userStats[k];
  });
  var unmapped = users.filter(function (u) {
    return u.how === "fallback";
  });
  var asanaUserCount = (x.snapshot.users || []).length;
  var mappedUsers = (x.snapshot.users || []).filter(function (u) {
    return x.staffByEmail[AI_lower(u.email)];
  }).length;
  var projectsOut = x.projects.map(function (p) {
    var n = x.taskRows.filter(function (r) {
      return r.source_project_gid === p.gid && !r.parent_gid;
    }).length;
    var skippedN = x.skipped.filter(function (s) {
      return s.project_gid === p.gid;
    }).length;
    return {
      gid: p.gid,
      name: p.name,
      team: p.team,
      archived: p.archived,
      target_kind: p.target_kind,
      client_id: p.client_id,
      suggested_client_id: p.client_id ? null : p.suggested_client_id,
      candidates: p.candidates,
      confidence: p.confidence,
      merged_into: p.merged_into || null,
      reason: p.reason,
      tasks_to_import: n,
      tasks_skipped: skippedN,
    };
  });
  var byKind = AI_count(x.projects, function (p) {
    return p.target_kind;
  });
  return {
    snapshot_at: x.snapshot.snapshot_at || null,
    fallback_email: x.fallback,
    totals: {
      asana_users: asanaUserCount,
      mapped_users: mappedUsers,
      unmapped_users: asanaUserCount - mappedUsers,
      projects: x.projects.length,
      client: byKind.client || 0,
      onboarding: byKind.onboarding || 0,
      internal: byKind.internal || 0,
      tracker: byKind.tracker || 0,
      skip: byKind.skip || 0,
      merged_away: x.projects.filter(function (p) {
        return p.merged_into;
      }).length,
      open_tasks_in_snapshot: (x.snapshot.tasks || []).length,
      open_subtasks_in_snapshot: (x.snapshot.subtasks || []).length,
      multi_homed_repeats: x.multiHomed,
      tasks_planned: x.taskRows.length,
      subtasks_planned: x.subtaskCount,
      to_create: create.length,
      already_imported: x.taskRows.length - create.length,
      projects_to_create: x.projectRows.length,
      draft_templates: x.templates.length,
      review_step_tasks: x.taskRows.filter(function (r) {
        return r.review_step;
      }).length,
      skipped: x.skipped.length,
    },
    skipped_by_reason: AI_count(x.skipped, function (s) {
      return s.reason;
    }),
    tasks_by_owner: AI_count(x.taskRows, function (r) {
      return r.assignee_email;
    }),
    owner_how: AI_count(x.taskRows, function (r) {
      return r.owner_how;
    }),
    tasks_by_client: AI_count(x.taskRows, function (r) {
      return r.client_id;
    }),
    tasks_by_status: AI_count(x.taskRows, function (r) {
      return r.status;
    }),
    unmapped_users: unmapped.map(function (u) {
      return { asana_name: u.asana_name, asana_email: u.asana_email, open_tasks: u.open_tasks, mapped_to: u.mapped_to };
    }),
    duplicates: x.duplicates,
    projects: projectsOut,
    client_missing: projectsOut
      .filter(function (p) {
        return (p.target_kind === "client" || p.target_kind === "onboarding") && !p.client_id && !p.merged_into;
      })
      .map(function (p) {
        return { gid: p.gid, name: p.name, target_kind: p.target_kind, suggested_client_id: p.suggested_client_id, confidence: p.confidence, candidates: p.candidates };
      }),
    anomalies_by_kind: AI_count(x.anomalies, function (a) {
      return a.kind;
    }),
    anomalies: x.anomalies,
    warnings: x.warnings,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    AI_key: AI_key,
    AI_normName: AI_normName,
    AI_coreName: AI_coreName,
    AI_slug: AI_slug,
    AI_matchClient: AI_matchClient,
    AI_teamBookkeeper: AI_teamBookkeeper,
    AI_classifyProject: AI_classifyProject,
    AI_pickWinner: AI_pickWinner,
    AI_status: AI_status,
    AI_cadence: AI_cadence,
    AI_description: AI_description,
    AI_plan: AI_plan,
  };
}
