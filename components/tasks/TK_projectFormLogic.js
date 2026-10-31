// ----------------------------------------------------------------------------
// TK_projectFormLogic: pure rules for the Slate plus New project form (hidden
// preview, docs/slateplus-projectform-spec.md). The view is
// TK_ProjectForm.jsx; with the Slate plus gate off TK_Sidebar.jsx shows the
// old form and nothing here runs. Browser file, shared global scope: every
// name carries a TKPF_ prefix. Node tests: TK_projectFormLogic.test.js.
//
// The server decides everything that matters (tk_projects / tk_project_members
// RLS and triggers); these are UI rules only:
//   - members: added after the project exists through TK_api.addMember (RLS
//     needs tk_can_manage_project, which the creator has as owner);
//   - client: a project tied to a client is kind "onboarding" with client_id
//     (the schema's tk_projects_client_kind check; insert RLS needs
//     can_access_client), the same shape as onboarding projects, so tasks
//     added in it file under that client;
//   - open to all staff: admins only (the insert trigger drops it otherwise).
// ----------------------------------------------------------------------------

var TKPF_DESC_MAX = 500;
var TKPF_MEMBER_MAX = 25;

// Built-in starter lists for "Start from". Each fills the Sections box; the
// person can still edit it before creating.
var TKPF_STARTERS = [
  { key: "board", label: "To do, Doing, Done", sections: ["To do", "Doing", "Done"] },
  {
    key: "monthend",
    label: "Month-end steps",
    sections: ["Gather statements", "Reconcile accounts", "Review and adjust", "Reports to client", "Close the month"],
  },
  {
    key: "onboarding",
    label: "Onboarding steps",
    sections: ["Kickoff", "Access and documents", "Clean-up", "First month close", "Handoff to bookkeeper"],
  },
];

function TKPF__lower(s) {
  return String(s == null ? "" : s).trim().toLowerCase();
}

function TKPF__byName(a, b) {
  var x = String((a && a.name) || "").toLowerCase();
  var y = String((b && b.name) || "").toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

// Description: line endings unified, more than one blank line squeezed,
// trimmed, cut to 500 characters. "" when empty.
function TKPF_cleanDescription(text) {
  var s = String(text == null ? "" : text).replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s.slice(0, TKPF_DESC_MAX).trim();
}

// Characters left for the description counter (never below 0).
function TKPF_descLeft(text) {
  var n = String(text == null ? "" : text).length;
  return Math.max(0, TKPF_DESC_MAX - n);
}

// A due date from a date input: "YYYY-MM-DD" that is a real calendar day
// between 2000 and 2100, else null.
function TKPF_cleanDue(s) {
  var v = String(s == null ? "" : s).trim();
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  var y = +m[1];
  var mo = +m[2];
  var d = +m[3];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null;
  var dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return v;
}

var TKPF_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Nov 3" (same year as today) or "Nov 3, 2027".
function TKPF_dateText(ymd, today) {
  var v = TKPF_cleanDue(ymd);
  if (!v) return "";
  var y = +v.slice(0, 4);
  var t = TKPF_cleanDue(today);
  var s = TKPF_MONTHS[+v.slice(5, 7) - 1] + " " + +v.slice(8, 10);
  return t && +t.slice(0, 4) === y ? s : s + ", " + y;
}

// The project header's due line: null without a due date, else
// { text, late }. Late: the date is before today and the project is not
// archived (an archived project is finished, so it is never late).
function TKPF_dueInfo(project, today) {
  var p = project || {};
  var due = TKPF_cleanDue(p.due_on);
  if (!due) return null;
  var t = TKPF_cleanDue(today);
  var late = !!t && due < t && !p.archived_at;
  var when = TKPF_dateText(due, t);
  return { text: late ? "Late: was due " + when : "Due " + when, late: late };
}

// "Start from" choices: the starter lists, then every project the viewer can
// see that is not archived and has sections (sorted by name).
function TKPF_templateOptions(projects) {
  var starters = TKPF_STARTERS.map(function (s) {
    return { value: "starter:" + s.key, label: s.label };
  });
  var copies = (Array.isArray(projects) ? projects : [])
    .filter(function (p) {
      return p && p.id && !p.archived_at && Array.isArray(p.sections) && p.sections.length > 0;
    })
    .slice()
    .sort(TKPF__byName)
    .map(function (p) {
      var n = p.sections.length;
      return { value: "project:" + p.id, label: (p.name || "Project") + " (" + n + (n === 1 ? " section)" : " sections)") };
    });
  return { starters: starters, copies: copies };
}

// The Sections box text for a "Start from" choice, or null for none/unknown.
function TKPF_templateText(value, projects) {
  var v = String(value == null ? "" : value);
  if (v.indexOf("starter:") === 0) {
    var key = v.slice(8);
    for (var i = 0; i < TKPF_STARTERS.length; i++) if (TKPF_STARTERS[i].key === key) return TKPF_STARTERS[i].sections.join("\n");
    return null;
  }
  if (v.indexOf("project:") === 0) {
    var id = v.slice(8);
    var list = Array.isArray(projects) ? projects : [];
    for (var j = 0; j < list.length; j++) {
      var p = list[j];
      if (p && String(p.id) === id && !p.archived_at && Array.isArray(p.sections) && p.sections.length) return p.sections.join("\n");
    }
  }
  return null;
}

// Staff the person can still pick: active, with an email, not themselves
// (they are the owner already) and not picked yet; sorted by name.
function TKPF_staffChoices(staff, picks, me) {
  var have = {};
  (Array.isArray(picks) ? picks : []).forEach(function (p) {
    if (p) have[TKPF__lower(p.email)] = 1;
  });
  var self = TKPF__lower(me);
  return (Array.isArray(staff) ? staff : [])
    .filter(function (s) {
      var e = TKPF__lower(s && s.email);
      return s && s.active !== false && e.indexOf("@") > 0 && e !== self && !have[e];
    })
    .slice()
    .sort(TKPF__byName);
}

// The picked people, cleaned: lowercased emails, never the creator, no
// duplicates (the first pick wins), role owner or member, at most 25.
function TKPF_normalizePicks(picks, me) {
  var out = [];
  var have = {};
  var self = TKPF__lower(me);
  (Array.isArray(picks) ? picks : []).forEach(function (p) {
    var e = TKPF__lower(p && p.email);
    if (e.indexOf("@") <= 0 || e === self || have[e]) return;
    have[e] = 1;
    out.push({ email: e, role: p.role === "owner" ? "owner" : "member" });
  });
  return out.slice(0, TKPF_MEMBER_MAX);
}

// Clients for the picker: the list the viewer already has (RLS-filtered),
// rows with an id, sorted by name. Ids as strings.
function TKPF_clientChoices(clients) {
  return (Array.isArray(clients) ? clients : [])
    .filter(function (c) {
      return c && c.id != null && String(c.id) !== "";
    })
    .map(function (c) {
      return { id: String(c.id), name: c.name || String(c.id) };
    })
    .sort(TKPF__byName);
}

// The visibility line under the form, and a warning when nobody else would
// see the project. o: { openToStaff, people (count of others), clientName }.
// Admins can always see every project; the help text says so.
function TKPF_visibility(o) {
  var x = o || {};
  if (x.openToStaff) return { summary: "Visible to all staff", warn: null };
  var n = Math.max(0, Number(x.people) || 0);
  var ppl = n + (n === 1 ? " person" : " people");
  var client = x.clientName ? "staff who work on " + x.clientName : "";
  var summary;
  if (n && client) summary = "Visible to you, " + ppl + " and " + client;
  else if (n) summary = "Visible to you and " + ppl;
  else if (client) summary = "Visible to you and " + client;
  else summary = "Visible only to you";
  var warn = null;
  if (!n && !client) {
    warn = x.canOpen
      ? "Only you will see this project. Add people below, or turn on Open to all staff."
      : "Only you will see this project. Add people below so others can see it.";
  }
  return { summary: summary, warn: warn };
}

// Plain help under the visibility setting. canOpen: the viewer gets the
// "Open to all staff" switch (admins only, as today).
function TKPF_visibilityHelp(canOpen) {
  if (canOpen) return "On: everyone on staff can see this project and add tasks to it. Off: only the owner, the people you add below and admins can see it.";
  return "Only you, the people you add below and admins can see this project. An admin can open it to all staff later.";
}

// The fields for TK_api.createProject. in: { name, sectionsList, kind
// ("onboarding" when the form was opened for a client), clientId (fixed or
// picked), openToStaff, color, description, dueOn, palette (color keys) }.
// A picked client makes the project kind "onboarding" with that client_id.
function TKPF_buildCreate(input) {
  var i = input || {};
  var client = i.clientId != null && String(i.clientId) !== "" ? String(i.clientId) : null;
  var kind = i.kind === "onboarding" || client ? "onboarding" : "internal";
  var out = {
    name: String(i.name == null ? "" : i.name).trim(),
    sections: Array.isArray(i.sectionsList) ? i.sectionsList.slice() : [],
    kind: kind,
    client_id: kind === "onboarding" ? client : null,
    open_to_staff: i.openToStaff === true,
  };
  var keys = Array.isArray(i.palette) ? i.palette : [];
  if (i.color && keys.indexOf(i.color) >= 0) out.color = i.color;
  var d = TKPF_cleanDescription(i.description);
  if (d) out.description = d;
  var due = TKPF_cleanDue(i.dueOn);
  if (due) out.due_on = due;
  return out;
}

// Adds the picked people one at a time (so one refusal never stops the rest)
// with addFn(projectId, email, role) -> Promise. Resolves (never rejects) with
// [{ email, role, ok, error }].
function TKPF_addMembers(addFn, projectId, picks) {
  var list = Array.isArray(picks) ? picks : [];
  var out = [];
  var step = function (k) {
    if (k >= list.length) return Promise.resolve(out);
    var p = list[k];
    var res;
    try {
      res = Promise.resolve(addFn(projectId, p.email, p.role));
    } catch (e) {
      res = Promise.reject(e);
    }
    return res.then(
      function () {
        out.push({ email: p.email, role: p.role, ok: true, error: null });
        return step(k + 1);
      },
      function (e) {
        out.push({ email: p.email, role: p.role, ok: false, error: e || null });
        return step(k + 1);
      },
    );
  };
  return step(0);
}

// Why one person could not be added, in plain words.
function TKPF_memberReason(err) {
  var code = err && err.code ? String(err.code) : "";
  var msg = err && err.message ? String(err.message) : "";
  if (code === "tk_member_inactive" || msg.indexOf("tk_member_inactive") >= 0) return "not an active staff member";
  if (code === "tk_offline") return "you were offline";
  if (code === "42501" || code === "tk_forbidden") return "not allowed";
  return "could not be added";
}

// The people who could not be added, named: [{ email, name, reason }].
function TKPF_failures(results, staff) {
  var names = {};
  (Array.isArray(staff) ? staff : []).forEach(function (s) {
    if (s && s.email) names[TKPF__lower(s.email)] = s.name || "";
  });
  return (Array.isArray(results) ? results : [])
    .filter(function (r) {
      return r && !r.ok;
    })
    .map(function (r) {
      var e = TKPF__lower(r.email);
      return { email: e, name: names[e] || e.split("@")[0], reason: TKPF_memberReason(r.error) };
    });
}

// One line for the "created, but" note.
function TKPF_failureText(failed) {
  var f = Array.isArray(failed) ? failed : [];
  if (!f.length) return "";
  var who = f
    .map(function (x) {
      return x.name + " (" + x.reason + ")";
    })
    .join(", ");
  return (
    "The project was created, but " +
    (f.length === 1 ? "1 person" : f.length + " people") +
    " could not be added: " +
    who +
    ". You can add them later from Members on the project page."
  );
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TKPF_DESC_MAX: TKPF_DESC_MAX,
    TKPF_MEMBER_MAX: TKPF_MEMBER_MAX,
    TKPF_STARTERS: TKPF_STARTERS,
    TKPF_cleanDescription: TKPF_cleanDescription,
    TKPF_descLeft: TKPF_descLeft,
    TKPF_cleanDue: TKPF_cleanDue,
    TKPF_dateText: TKPF_dateText,
    TKPF_dueInfo: TKPF_dueInfo,
    TKPF_templateOptions: TKPF_templateOptions,
    TKPF_templateText: TKPF_templateText,
    TKPF_staffChoices: TKPF_staffChoices,
    TKPF_normalizePicks: TKPF_normalizePicks,
    TKPF_clientChoices: TKPF_clientChoices,
    TKPF_visibility: TKPF_visibility,
    TKPF_visibilityHelp: TKPF_visibilityHelp,
    TKPF_buildCreate: TKPF_buildCreate,
    TKPF_addMembers: TKPF_addMembers,
    TKPF_memberReason: TKPF_memberReason,
    TKPF_failures: TKPF_failures,
    TKPF_failureText: TKPF_failureText,
  };
}
