// Tasks Phase 2, S8: one-time import of OPEN Asana tasks, the planner.
//
// Pure functions: no network, no Supabase, no file system. It takes an Asana
// snapshot (projects, sections, open tasks, open subtasks, users, teams) plus
// the portal's staff and clients, and returns the plan: which tk_projects rows,
// staff_reminders rows and draft task_templates rows an apply would create,
// what it would skip and why, and the dry-run report.
//
// Owner decisions (spec OD7, revised 2026-10-16 in S8b): OPEN tasks only, no
// completed history. Asana users with no staff row go to a remap target
// (ctx.userRemap, e.g. Naomi -> Sonya) or else the fallback address (passed
// in, never hard-coded). Duplicate projects COMBINE: open tasks from every
// copy (archived copies too) land on one project, and only obvious repeats
// (same title, section and due date) drop. Unassigned Asana tasks stay
// unassigned (assignee_email null; staff_email is only the row owner).
// Recurring sections become draft templates whose due rule, lead time and
// assignee mirror the open Asana instance. We never create clients: a
// project whose client is not in `clients` is skipped and listed; the
// roster step (AI_buildRoster) proposes the client list for the owner to
// approve. Nothing here writes anywhere; supabase/tasks-p2-8-asana-import.sql
// and tasks-p2-10-asana-import-v2.sql apply a staged plan, and only when the
// owner turns it on.
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
// A client may carry aliases (the Asana project names a roster entry was built
// from); an exact alias hit counts as high.
function AI_matchClient(name, clients) {
  var core = AI_coreName(name);
  var norm = AI_normName(name);
  var high = [];
  var medium = [];
  (clients || []).forEach(function (c) {
    var cCore = AI_coreName(c.name);
    var aliasHit = (c.aliases || []).some(function (a) {
      return AI_normName(a) === norm || AI_coreName(a) === core;
    });
    if (aliasHit || c.id === AI_slug(name) || AI_normName(c.name) === norm || (cCore && cCore === core)) {
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

// "Nicole's Clients" -> the staff row whose first name is Nicole. remap
// (ctx.userRemap) sends a departed bookkeeper's team to someone else:
// {naomi: "sonya@..."} makes "Naomi's Clients" Sonya's.
function AI_teamBookkeeper(teamName, staff, remap) {
  var m = /^\s*([A-Za-z]+)['’]s clients\s*$/i.exec(teamName || "");
  if (!m) return null;
  var first = m[1].toLowerCase();
  if (remap && remap[first]) return AI_lower(remap[first]);
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

// Recurring due rule that reproduces an open Asana instance's due date in the
// recurring engine (tk_resolve_due, supabase/tasks-p2-1-calendar.sql). The
// snapshot has no Asana repeat settings, so the cadence comes from the section
// name and the day from the open instance:
//   weekly    -> {weekday, dow}: same weekday every week
//   monthly   -> {day_of_month, day, month_offset 1, roll none}: same day each
//                month, labeled for the month before (month-end work)
//   quarterly -> {day_of_month, day, month_offset 1..3 after the quarter end}
//   annually  -> {day_of_month, day, month_offset = month (from Dec 31)}
// roll 'none' keeps Asana's exact dates, weekends included. Lead days (how
// early the task appears) stand in for Asana showing the next one at once.
var AI_LEAD = { weekly: 4, monthly: 14, quarterly: 30, annually: 30 };
function AI_dueRule(cadence, due) {
  var lead = AI_LEAD[cadence] || 14;
  if (!AI_LEAD[cadence]) return { rule: null, lead_days: lead, note: "unknown_cadence" };
  if (!AI_dateOk(due)) return { rule: null, lead_days: lead, note: "no_due_date" };
  var dt = new Date(Date.parse(due + "T00:00:00Z"));
  var dom = dt.getUTCDate();
  var m = dt.getUTCMonth() + 1;
  var isodow = dt.getUTCDay() === 0 ? 7 : dt.getUTCDay();
  if (cadence === "weekly") {
    return { rule: { type: "weekday", dow: isodow }, lead_days: lead, note: isodow > 5 ? "weekend_due_rolls_to_monday" : null };
  }
  var off = cadence === "monthly" ? 1 : cadence === "quarterly" ? ((m - 1) % 3) + 1 : m;
  return { rule: { type: "day_of_month", day: dom, month_offset: off, roll: "none" }, lead_days: lead, note: dom > 28 ? "day_clamped_in_short_months" : null };
}

// ---- Roster (owner decision 1) ------------------------------------------------
// Proposes one client per Asana client (client and onboarding projects and the
// onboarding tracker's sections that share a core name, duplicates combined),
// matched to the firm's QuickBooks customers. It never writes: the owner
// approves the list, then clients are created by hand / the client tools.
// input = {projects: AI_plan().project_map, trackerSections: [name],
//          qbo: [{id, name, display, active, is_job, last_invoice}],
//          staff, userRemap, liveClients}
var AI_ORG_WORDS = /church|ministr|llc|inc\b|foundation|network|center|club|academy|company|group|services|insurance|associates|county|mission|initiative|ranch|solutions|photography|therapy|fellowship|wheels|health|novo|together|newport/i;
function AI_qboClean(s) {
  return AI_clean(s)
    .replace(/\s*\(deleted\)\s*$/i, "")
    .replace(/\s*\(\s*\d+\s*\)\s*/g, " ")
    .replace(/_\d{6,}$/, "")
    .replace(/-\d+$/, "")
    .trim();
}
function AI_initials(s) {
  return AI_normName(s)
    .split(" ")
    .filter(Boolean)
    .map(function (w) {
      return w[0];
    })
    .join("");
}
function AI_buildRoster(input) {
  var projects = (input.projects || []).filter(function (p) {
    return p.target_kind === "client" || p.target_kind === "onboarding";
  });
  var sources = [];
  projects.forEach(function (p) {
    // a split project is several real clients: one source (so one roster entry) per client
    if (p.split && p.split.length) {
      p.split.forEach(function (c) {
        sources.push({ name: c.name, kind: p.target_kind, gid: p.gid, team: p.team || null, archived: !!p.archived });
      });
      return;
    }
    sources.push({ name: p.name, kind: p.target_kind, gid: p.gid, team: p.team || null, archived: !!p.archived });
  });
  (input.trackerSections || []).forEach(function (s) {
    if (AI_clean(s)) sources.push({ name: AI_clean(s), kind: "tracker_section", gid: null, team: null, archived: false });
  });
  var groups = {};
  var order = [];
  sources.forEach(function (s) {
    var k = AI_coreName(s.name);
    if (!groups[k]) {
      groups[k] = [];
      order.push(k);
    }
    groups[k].push(s);
  });
  var qbo = (input.qbo || [])
    .filter(function (q) {
      return !q.is_job && !/my good ?books/i.test(q.display || q.name || "");
    })
    .map(function (q) {
      var display = AI_qboClean(q.display || q.name);
      var company = AI_qboClean(q.name || q.display);
      return {
        id: String(q.id),
        name: display,
        aliases: company && company !== display ? [company] : [],
        active: q.active !== false && !/\(deleted\)/i.test(q.display || ""),
        suffixed: /_\d{6,}$|-\d+$|\(\s*\d+\s*\)/.test(q.display || ""),
        last_invoice: q.last_invoice || null,
      };
    });
  var live = (input.liveClients || []).filter(function (c) {
    return !c.test_only && !c.is_internal;
  });
  var usedIds = {};
  var usedQbo = {};
  var entries = order.map(function (k) {
    var list = groups[k];
    var main =
      list.filter(function (s) {
        return s.kind === "client" && !s.archived;
      })[0] ||
      list.filter(function (s) {
        return !s.archived;
      })[0] ||
      list[0];
    var teamSrc =
      list.filter(function (s) {
        return /'s clients$/i.test(s.team || "");
      })[0] ||
      list.filter(function (s) {
        return s.team;
      })[0];
    var team = teamSrc ? teamSrc.team : null;
    var bk = team ? AI_teamBookkeeper(team, input.staff, input.userRemap) : null;
    // QuickBooks match: every Asana name in the group, then acronyms (MBTR+V)
    var cands = {};
    var conf = "none";
    list.forEach(function (s) {
      var m = AI_matchClient(s.name, qbo);
      m.candidates.forEach(function (id) {
        cands[id] = true;
      });
      if (m.confidence === "high" || (m.confidence === "medium" && conf !== "high")) conf = m.confidence;
      else if (m.confidence === "ambiguous" && conf === "none") conf = "ambiguous";
    });
    if (!Object.keys(cands).length) {
      list.forEach(function (s) {
        var first = AI_normName(s.name).split(" ")[0] || "";
        if (first.length < 3) return;
        qbo.forEach(function (q) {
          if (AI_initials(q.name).indexOf(first) === 0) cands[q.id] = true;
        });
      });
      if (Object.keys(cands).length) conf = "acronym";
    }
    var candList = qbo.filter(function (q) {
      return cands[q.id];
    });
    var active = candList.filter(function (q) {
      return q.active;
    });
    var pool = active.length ? active : candList;
    // one record per name: the duplicate QuickBooks records (Unco Church_1761…, -1) lose to the plain one
    var byNorm = {};
    pool.forEach(function (q) {
      var n = AI_normName(q.name);
      var cur = byNorm[n];
      if (!cur || (cur.suffixed && !q.suffixed) || (!cur.last_invoice && q.last_invoice)) byNorm[n] = q;
    });
    var picked = Object.keys(byNorm).map(function (n) {
      return byNorm[n];
    });
    var qPick = picked.length === 1 ? picked[0] : null;
    if (picked.length > 1) conf = "ambiguous";
    // several records of one name (Manna Church + Manna Church (deleted)) that collapse to one: a plain hit
    else if (qPick && conf === "ambiguous") conf = "high";
    if (qPick) usedQbo[qPick.id] = true;
    var liveHit = AI_matchClient(main.name, live);
    var name = qPick ? qPick.name : main.name;
    var id = liveHit.client_id || AI_slug(name);
    var base = id;
    var n = 2;
    while (usedIds[id] && !liveHit.client_id) id = base + "-" + n++;
    usedIds[id] = true;
    return {
      proposed_client_id: id,
      existing_client: !!liveHit.client_id,
      name: name,
      aliases: list
        .map(function (s) {
          return s.name;
        })
        .filter(function (v, i, a) {
          return a.indexOf(v) === i;
        }),
      asana_projects: list,
      team: team,
      group: team || "No team yet",
      bookkeeper_email: bk,
      qbo: qPick ? { id: qPick.id, name: qPick.name, active: qPick.active, last_invoice: qPick.last_invoice } : null,
      qbo_confidence: qPick ? conf : picked.length > 1 ? "ambiguous" : "none",
      qbo_candidates: picked.length > 1
        ? picked.map(function (q) {
            return { id: q.id, name: q.name, active: q.active };
          })
        : [],
      status: "proposed",
    };
  });
  // Last try for the rest: same first word ("Zeal Church" -> "Zeal City Church", "Fade" -> "Fade Group LLC"),
  // among active records no other entry took. Marked "first word" so the owner checks it.
  entries.forEach(function (e) {
    if (e.qbo || e.qbo_candidates.length) return;
    var hits = {};
    e.asana_projects.forEach(function (s) {
      var w = AI_coreName(s.name).split(" ")[0] || "";
      if (w.length < 3) return;
      qbo.forEach(function (q) {
        if (q.active && !q.suffixed && !usedQbo[q.id] && AI_coreName(q.name).split(" ")[0] === w) hits[q.id] = q;
      });
    });
    var list = Object.keys(hits).map(function (id) {
      return hits[id];
    });
    if (list.length === 1) {
      usedQbo[list[0].id] = true;
      e.qbo = { id: list[0].id, name: list[0].name, active: list[0].active, last_invoice: list[0].last_invoice };
      e.qbo_confidence = "first word";
    } else if (list.length > 1) {
      e.qbo_confidence = "ambiguous";
      e.qbo_candidates = list.map(function (q) {
        return { id: q.id, name: q.name, active: q.active };
      });
    }
  });
  entries.sort(function (a, b) {
    var ga = a.group === "No team yet" ? "~" : a.group;
    var gb = b.group === "No team yet" ? "~" : b.group;
    if (ga !== gb) return ga < gb ? -1 : 1;
    return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
  });
  var qboOnly = qbo
    .filter(function (q) {
      return q.active && !q.suffixed && !usedQbo[q.id];
    })
    .filter(function (q) {
      // a plain duplicate of a matched record is not "QuickBooks only"
      return !entries.some(function (e) {
        return e.qbo && AI_normName(e.qbo.name) === AI_normName(q.name);
      });
    })
    .map(function (q) {
      return { id: q.id, name: q.name, last_invoice: q.last_invoice, looks_personal: !AI_ORG_WORDS.test(q.name) };
    });
  var byGroup = AI_count(entries, function (e) {
    return e.group;
  });
  return {
    entries: entries,
    qbo_only: qboOnly,
    summary: {
      asana_clients: entries.length,
      qbo_matched: entries.filter(function (e) {
        return e.qbo;
      }).length,
      qbo_ambiguous: entries.filter(function (e) {
        return e.qbo_confidence === "ambiguous";
      }).length,
      qbo_none: entries.filter(function (e) {
        return !e.qbo && e.qbo_confidence !== "ambiguous";
      }).length,
      with_bookkeeper: entries.filter(function (e) {
        return e.bookkeeper_email;
      }).length,
      no_team_yet: byGroup["No team yet"] || 0,
      by_group: byGroup,
      qbo_only_active: qboOnly.length,
    },
  };
}

// Roster entries as the `clients` input of AI_plan (the what-if plan).
function AI_rosterClients(roster) {
  return (roster.entries || []).map(function (e) {
    return { id: e.proposed_client_id, name: e.name, aliases: e.aliases, assigned_bookkeeper_email: e.bookkeeper_email, roster_group: e.group };
  });
}

// Which client of a split project a task belongs to: the section decides first
// ("Monthly - Woodlands"), then the title ("QBO feed - LA" in "Weekly - Both").
// split = [{client_id, name, match: "<regex source>"}]. Returns the entry, or null
// when nothing (or more than one client) matches.
function AI_splitClient(split, task) {
  function hits(text) {
    return (split || []).filter(function (c) {
      return new RegExp(c.match, "i").test(text || "");
    });
  }
  var bySec = hits(AI_clean(task.sec || ""));
  if (bySec.length) return bySec.length === 1 ? bySec[0] : null;
  var byTitle = hits(AI_clean(task.n || ""));
  return byTitle.length === 1 ? byTitle[0] : null;
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
  var split = (ctx.splits || {})[p.gid];
  if (split && split.clients && split.clients.length) {
    // One Asana project that holds several real clients (Hosanna Church = Woodlands + LA):
    // each task is routed to a client by its section, then by its title (see AI_splitClient).
    out.target_kind = "client";
    out.confidence = "owner";
    out.reason = split.note || "owner split: one Asana project, several clients";
    out.split = split.clients;
    return out;
  }
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

// "Obvious repeat" in a combined project: same title, same section, same due date.
function AI_taskTitleKey(t) {
  return AI_clean(t.n).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + "|" + AI_clean(t.sec || "").toLowerCase() + "|" + (t.d || "");
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
//        importedKeys:[...] (keys already in tk_asana_import_map),
//        userRemap:{<asana email or first name, lower case>: staff email} (Naomi -> Sonya)}
// A client may carry aliases[] and roster_group (from AI_rosterClients).
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
    return AI_classifyProject(p, { clients: ctx.clients, staff: ctx.staff, teams: snapshot.teams, overrides: ctx.overrides, splits: ctx.splits });
  });
  var projByGid = {};
  projects.forEach(function (p) {
    projByGid[p.gid] = p;
  });

  // 2. Duplicates: same target and same normalized name. They COMBINE (owner, S8b): the newest
  // copy is the one project every copy maps to, and open tasks from all copies (archived too)
  // come along; only obvious repeats drop (same title, section and due date).
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
      tasks_from_archived: 0,
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
  var remap = {};
  Object.keys(ctx.userRemap || {}).forEach(function (k) {
    remap[String(k).toLowerCase()] = ctx.userRemap[k];
  });
  var asanaUsers = {};
  (snapshot.users || []).forEach(function (u) {
    asanaUsers[AI_lower(u.email) || "gid:" + u.gid] = u;
  });
  // A first-name remap key ({naomi: ...}) is meant for one person: it applies only
  // when exactly one Asana identity in the snapshot has that first name.
  var firstNameIds = {};
  function firstOf(name) {
    return String(name || "").trim().split(/\s+/)[0].toLowerCase();
  }
  function noteFirst(email, name) {
    var f = firstOf(name);
    if (!f) return;
    var id = AI_lower(email) || "name:" + String(name).trim().toLowerCase();
    (firstNameIds[f] = firstNameIds[f] || {})[id] = true;
  }
  (snapshot.users || []).forEach(function (u) {
    noteFirst(u.email, u.name);
  });
  (snapshot.tasks || []).concat(snapshot.subtasks || []).forEach(function (t) {
    noteFirst(t.a, t.an || (asanaUsers[AI_lower(t.a)] || {}).name);
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
    var first = firstOf(name || (asanaUsers[e] || {}).name);
    var activeMatch = !!(e && staffByEmail[e] && staffByEmail[e].active !== false);
    // An email remap always wins; a first-name remap never overrides a real (active)
    // email match and only applies to the single person with that first name.
    var re = AI_lower(
      remap[e] ||
        (first && !activeMatch && remap[first] && Object.keys(firstNameIds[first] || {}).length === 1 ? remap[first] : null)
    );
    if (re && staffByEmail[re] && staffByEmail[re].active !== false) {
      st.mapped_to = re;
      st.how = "remapped";
    } else if (e && staffByEmail[e]) {
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
      var tk = proj.gid + "|" + AI_taskTitleKey(t);
      if (winnerTitleKeys[tk]) {
        if (d) d.tasks_dropped++;
        skip(t.g, t.p, "duplicate_in_merged_project", { kept_gid: winnerTitleKeys[tk] });
        return;
      }
      if (d) {
        d.tasks_merged++;
        if (src.archived) d.tasks_from_archived++;
      }
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
    } else if (kind === "client" && proj.split) {
      var sc = AI_splitClient(proj.split, t);
      if (!sc) {
        skip(t.g, t.p, "split_client_unclear", { section: t.sec || null });
        return;
      }
      if (!clientById[sc.client_id]) {
        skip(t.g, t.p, "client_missing", { client_id: sc.client_id });
        return;
      }
      clientId = sc.client_id;
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
    var assignee = u.mapped_to;
    var ownerHow = u.how;
    // The row owner (staff_email, never null): the assignee, else the client's bookkeeper,
    // else the team's bookkeeper, else the fallback. An unassigned Asana task stays
    // unassigned (assignee null, owner decision 7); anyone who can see it may claim it.
    var owner = assignee;
    var ownerFrom = "assignee";
    if (!assignee) {
      var c = r.client_id ? clientById[r.client_id] : null;
      var tb = AI_teamBookkeeper(r._team, ctx.staff, remap);
      if (c && c.assigned_bookkeeper_email && staffByEmail[AI_lower(c.assigned_bookkeeper_email)]) {
        owner = AI_lower(c.assigned_bookkeeper_email);
        ownerFrom = "client_bookkeeper";
      } else if (tb && staffByEmail[tb]) {
        owner = tb;
        ownerFrom = "team_bookkeeper";
      } else {
        owner = fallback;
        ownerFrom = "fallback";
      }
    }
    u.open_tasks++;
    r.assignee_email = assignee || null;
    r.staff_email = owner;
    r.owner_how = ownerHow;
    r.owner_from = ownerFrom;
    if ((ownerHow === "fallback" || ownerHow === "remapped") && r._an) r.description_footer.push("Asana assignee: " + r._an);

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
      [r.assignee_email, r.staff_email].forEach(function (e) {
        if (e && mem.indexOf(e) < 0 && staffByEmail[e] && staffByEmail[e].active !== false) mem.push(e);
      });
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
    // Mirror the Asana instance: due rule from its date, assignee from its assignee.
    var dr = AI_dueRule(cad, r.due_date);
    var cl = clientById[r.client_id] || {};
    var bk = AI_lower(cl.assigned_bookkeeper_email);
    var mode = !r.assignee_email ? "unassigned" : r.assignee_email === bk ? "bookkeeper" : "person";
    templates.push({
      key: AI_key("template", r.asana_gid),
      asana_gid: r.asana_gid,
      title: AI_truncate(r.title, 200),
      cadence: cad,
      client_id: r.client_id,
      checklist: checklist,
      due_rule: dr.rule,
      lead_days: dr.lead_days,
      rule_note: dr.note,
      assignee_role: "bookkeeper",
      assignee_email: mode === "person" ? r.assignee_email : null,
      leave_unassigned: mode === "unassigned",
      assignee_mode: mode,
      instance_gid: r.asana_gid,
      instance_due: r.due_date,
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
        owner_from: r.owner_from,
        roster_group: (clientById[r.client_id] || {}).roster_group || null,
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
    return u.how === "fallback" || u.how === "remapped";
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
      unassigned_tasks: x.taskRows.filter(function (r) {
        return !r.assignee_email;
      }).length,
      says_done_tasks: x.anomalies.filter(function (a) {
        return a.kind === "open_but_progress_says_done";
      }).length,
      skipped: x.skipped.length,
    },
    skipped_by_reason: AI_count(x.skipped, function (s) {
      return s.reason;
    }),
    tasks_by_owner: AI_count(x.taskRows, function (r) {
      return r.assignee_email || "(unassigned)";
    }),
    owner_how: AI_count(x.taskRows, function (r) {
      return r.owner_how;
    }),
    unassigned_row_owner: AI_count(
      x.taskRows.filter(function (r) {
        return !r.assignee_email;
      }),
      function (r) {
        return r.owner_from;
      }
    ),
    tasks_by_roster_group: AI_count(x.taskRows, function (r) {
      return r.roster_group;
    }),
    templates_by_cadence: AI_count(x.templates, function (t) {
      return t.cadence;
    }),
    templates_by_assignee_mode: AI_count(x.templates, function (t) {
      return t.assignee_mode;
    }),
    templates_rule_notes: AI_count(x.templates, function (t) {
      return t.rule_note;
    }),
    tasks_by_client: AI_count(x.taskRows, function (r) {
      return r.client_id;
    }),
    tasks_by_status: AI_count(x.taskRows, function (r) {
      return r.status;
    }),
    unmapped_users: unmapped.map(function (u) {
      return { asana_name: u.asana_name, asana_email: u.asana_email, open_tasks: u.open_tasks, mapped_to: u.mapped_to, how: u.how };
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
    AI_dueRule: AI_dueRule,
    AI_splitClient: AI_splitClient,
    AI_buildRoster: AI_buildRoster,
    AI_rosterClients: AI_rosterClients,
    AI_qboClean: AI_qboClean,
    AI_classifyProject: AI_classifyProject,
    AI_pickWinner: AI_pickWinner,
    AI_status: AI_status,
    AI_cadence: AI_cadence,
    AI_description: AI_description,
    AI_plan: AI_plan,
  };
}
