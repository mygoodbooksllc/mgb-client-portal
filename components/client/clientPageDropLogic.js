// Client page drop + staff Documents upgrades: pure rules
// (docs/client-page-drop.md). No React, no Supabase, no DOM; the node test is
// clientPageDropLogic.test.js. Loads after basicHomeLogic.js (it reuses
// BH_pickFiles for the type and size checks) and before CPD_gate.js.

var CPD_MAX_FILES = 10;
var CPD_NAME_MAX = 200;

// ---- The gate's pure parts (CPD_gate.js uses them) -----------------------
function CPD_switchValue(v) {
  return v === true || v === "true" || v === 1 || (!!v && typeof v === "object" && v.on === true);
}

// Same rule as the database's cpd__on: enabled AND (pilot "all" OR lists it).
function CPD_switchOnFor(enabled, pilot, clientId) {
  if (!CPD_switchValue(enabled) || !clientId) return false;
  if (pilot === "all") return true;
  if (Array.isArray(pilot)) return pilot.indexOf(clientId) >= 0;
  return false;
}

// Staff Documents upgrades: the person's preview, or the firm switch on.
function CPD_staffPlus(previewOn, enabled) {
  return previewOn === true || CPD_switchValue(enabled);
}

// ---- Files ---------------------------------------------------------------
// Adds a drop or pick to what's already waiting: the type and size checks
// from basicHomeLogic.js, then the 10-file cap. existing = files already in
// the dialog.
function CPD_takeFiles(list, existing) {
  var pickFn = typeof BH_pickFiles === "function" ? BH_pickFiles : require("./basicHomeLogic.js").BH_pickFiles;
  var sigFn = typeof BH_fileSig === "function" ? BH_fileSig : require("./basicHomeLogic.js").BH_fileSig;
  var picked = pickFn(list);
  var have = {};
  (existing || []).forEach(function (f) {
    have[sigFn(f)] = true;
  });
  var room = Math.max(0, CPD_MAX_FILES - (existing || []).length);
  var accepted = [];
  var rejected = picked.rejected.slice();
  picked.accepted.forEach(function (f) {
    if (have[sigFn(f)]) return;
    if (accepted.length >= room) {
      rejected.push({ name: String(f.name || "File"), reason: "Up to " + CPD_MAX_FILES + " files at a time. Add it after these finish." });
      return;
    }
    accepted.push(f);
  });
  return { accepted: accepted, rejected: rejected };
}

// "March statement.pdf" -> "March statement".
function CPD_defaultName(fileName) {
  var s = String(fileName || "").trim();
  var dot = s.lastIndexOf(".");
  return dot > 0 ? s.slice(0, dot) : s;
}

// { value, error }: trimmed, control characters as spaces, 1-200 characters.
function CPD_cleanName(s) {
  var v = String(s == null ? "" : s)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim();
  if (!v) return { value: "", error: "Give it a name." };
  if (v.length > CPD_NAME_MAX) return { value: v, error: "Names can be " + CPD_NAME_MAX + " characters at most." };
  return { value: v, error: null };
}

// The display name to send for one file: null when it's just the file's own
// name without its extension (so nothing extra is stored).
function CPD_displayNameFor(fileName, typed) {
  var c = CPD_cleanName(typed);
  if (c.error) return null;
  if (c.value === String(fileName || "").trim() || c.value === CPD_defaultName(fileName)) return null;
  return c.value;
}

// Short file type tag from the name (and mime as a fallback).
var CPD_TYPE_TAGS = {
  pdf: "PDF",
  png: "Image",
  jpg: "Image",
  jpeg: "Image",
  heic: "Image",
  gif: "Image",
  csv: "CSV",
  txt: "Text",
  xlsx: "Excel",
  xls: "Excel",
  docx: "Word",
  doc: "Word",
};
function CPD_fileTypeTag(name, mime) {
  var n = String(name || "");
  var dot = n.lastIndexOf(".");
  var ext = dot > 0 ? n.slice(dot + 1).toLowerCase() : "";
  if (ext && CPD_TYPE_TAGS[ext]) return CPD_TYPE_TAGS[ext];
  var m = String(mime || "").toLowerCase();
  if (m === "application/pdf") return "PDF";
  if (m.indexOf("image/") === 0) return "Image";
  if (m.indexOf("spreadsheet") >= 0 || m === "application/vnd.ms-excel") return "Excel";
  if (m.indexOf("wordprocessing") >= 0) return "Word";
  if (m === "text/csv") return "CSV";
  if (m.indexOf("text/") === 0) return "Text";
  if (ext && ext.length <= 5) return ext.toUpperCase();
  return "File";
}

// ---- Who can see it -------------------------------------------------------
// logins: [{ email, name, is_me }] (active logins). Returns what to save:
//   { mode, emails, dropped: [emails no longer active], error }
// - "only" always includes me when I'm a client login (the database adds the
//   uploader too); "except" never lists me.
// - Emails that no longer have an active login are dropped (the database
//   refuses them), and reported so the dialog can say so.
function CPD_normalizeAccess(mode, emails, logins, me) {
  var m = mode === "only" || mode === "except" ? mode : "everyone";
  var active = {};
  (logins || []).forEach(function (l) {
    if (l && l.email) active[String(l.email).toLowerCase()] = true;
  });
  var mine = String(me || "").toLowerCase();
  var seen = {};
  var list = [];
  var dropped = [];
  (emails || []).forEach(function (e) {
    var v = String(e || "").trim().toLowerCase();
    if (!v || seen[v]) return;
    seen[v] = true;
    // An 'except' list keeps people whose login went inactive (they stay
    // hidden; the server keeps them too). An 'only' list drops them.
    if (!active[v] && m !== "except") dropped.push(v);
    else list.push(v);
  });
  if (m === "everyone") return { mode: m, emails: [], dropped: [], error: null };
  if (m === "only" && mine && active[mine] && list.indexOf(mine) < 0) list.unshift(mine);
  if (m === "except") list = list.filter(function (v) {
    return v !== mine;
  });
  list.sort();
  if (!list.length) return { mode: m, emails: list, dropped: dropped, error: "Pick at least one person." };
  if (list.length > 50) return { mode: m, emails: list, dropped: dropped, error: "50 people at most." };
  return { mode: m, emails: list, dropped: dropped, error: null };
}

// The emails on a saved list that no longer have an active login.
function CPD_staleEmails(emails, logins) {
  var active = {};
  (logins || []).forEach(function (l) {
    if (l && l.email) active[String(l.email).toLowerCase()] = true;
  });
  return (emails || []).filter(function (e) {
    return !active[String(e || "").toLowerCase()];
  });
}

// Badge text: "Everyone", "Only 2 people", "Everyone except 1".
function CPD_accessBadge(mode, count) {
  var n = Number(count) || 0;
  if (mode === "only") return "Only " + n + " " + (n === 1 ? "person" : "people");
  if (mode === "except") return "Everyone except " + n;
  return "Everyone";
}

// Can this login see the file? (Staff View as filters with it; the database
// is the real gate for clients.) rows: the file's client_file_access emails.
function CPD_loginSees(mode, rowsEmails, email) {
  if (mode !== "only" && mode !== "except") return true;
  var e = String(email || "").toLowerCase();
  var listed = (rowsEmails || []).some(function (x) {
    return String(x || "").toLowerCase() === e;
  });
  return mode === "only" ? listed : !listed;
}

// ---- Errors and summaries -------------------------------------------------
function CPD_errorText(err) {
  var code = err && err.code;
  var status = err && err.status;
  var msg = String((err && err.message) || "");
  if (code === "drive_not_connected") return "File storage is down for a moment. Try again shortly.";
  if (code === "bad_access_list" || /bad_access_list/.test(msg)) return "One of those people no longer has a login. Refresh and try again.";
  if (code === "feature_off" || /feature_off/.test(msg)) return "Choosing who can see a file isn't turned on yet.";
  if (code === "too_big" || status === 413) return "Over 25 MB.";
  if (code === "bad_type" || code === "blocked_type" || status === 415) return "Not a type we take (PDF, PNG, JPEG, HEIC, CSV, Excel, Word and text files only).";
  if (code === "forbidden" || /forbidden/.test(msg)) return "You don't have permission to do that.";
  return msg || "Didn't upload.";
}

function CPD_summary(ok, failed) {
  var plural = function (n) {
    return n + " file" + (n === 1 ? "" : "s");
  };
  if (!failed) return "Added " + plural(ok) + ". Your bookkeeper can see " + (ok === 1 ? "it" : "them") + " now.";
  if (!ok) return "Couldn't upload " + plural(failed) + ". Nothing was lost; try again.";
  return ok + " of " + (ok + failed) + " uploaded; " + failed + " didn't go through. Try those again.";
}

// ---- Access history (staff) ----------------------------------------------
// rows from client_file_access_history: { at, action, ok, actor, detail }.
// Returns [{ at, actor, text }] newest first; skips failed rows.
function CPD_historyLines(rows) {
  var out = [];
  (rows || []).forEach(function (r) {
    if (!r || r.ok === false) return;
    var d = {};
    try {
      d = JSON.parse(r.detail || "{}") || {};
    } catch (e) {
      d = {};
    }
    var text;
    if (r.action === "upload")
      text = "Uploaded" + (d.access_mode === "only" ? ", for only some people" : d.access_mode === "except" ? ", hidden from some people" : "");
    else if (r.action === "access_changed") {
      text = "Who can see it: " + CPD_accessBadge(d.access_mode, d.count);
      if (Array.isArray(d.emails) && d.emails.length && d.access_mode !== "everyone") text += " (" + d.emails.join(", ") + ")";
      if (d.display_name_changed) text += "; name changed";
    } else if (r.action === "renamed") text = "Renamed" + (d.to ? " to “" + d.to + "”" : "");
    else if (r.action === "trash") text = "Moved to Trash";
    else if (r.action === "restore") text = "Restored from Trash";
    else text = String(r.action || "Changed");
    out.push({ at: r.at || null, actor: r.actor || "", text: text });
  });
  return out;
}

// Deep link for Copy link: the page URL without its hash, plus the
// LK_href hash (components/staff/DeepLink.jsx).
function CPD_copyLinkUrl(origin, pathname, hashHref) {
  var h = String(hashHref || "");
  if (h && h.charAt(0) !== "#") h = "#" + h.replace(/^#?/, "");
  return String(origin || "") + String(pathname || "/") + h;
}

// The folder name rule (document_folders: 1-60 characters, unique).
function CPD_folderNameError(name, existing, current) {
  var v = String(name || "").trim();
  if (!v) return "Give the folder a name.";
  if (v.length > 60) return "Folder names can be 60 characters at most.";
  if (v !== current && (existing || []).indexOf(v) >= 0) return "“" + v + "” already exists.";
  return null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CPD_MAX_FILES: CPD_MAX_FILES,
    CPD_NAME_MAX: CPD_NAME_MAX,
    CPD_switchValue: CPD_switchValue,
    CPD_switchOnFor: CPD_switchOnFor,
    CPD_staffPlus: CPD_staffPlus,
    CPD_takeFiles: CPD_takeFiles,
    CPD_defaultName: CPD_defaultName,
    CPD_cleanName: CPD_cleanName,
    CPD_displayNameFor: CPD_displayNameFor,
    CPD_fileTypeTag: CPD_fileTypeTag,
    CPD_normalizeAccess: CPD_normalizeAccess,
    CPD_staleEmails: CPD_staleEmails,
    CPD_accessBadge: CPD_accessBadge,
    CPD_loginSees: CPD_loginSees,
    CPD_errorText: CPD_errorText,
    CPD_summary: CPD_summary,
    CPD_historyLines: CPD_historyLines,
    CPD_copyLinkUrl: CPD_copyLinkUrl,
    CPD_folderNameError: CPD_folderNameError,
  };
}
