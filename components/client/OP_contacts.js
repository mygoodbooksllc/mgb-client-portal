// Client contacts in the org profile (docs/client-contacts-spec.md): pure
// helpers, global scope, node-testable. Loads right before OP_store.js.
// Mirrors the server rules in supabase/client-contacts.sql (cc__email_ok,
// cc__people, client_org_profile_save's people section). The server is still
// the judge: it re-validates every change.
// Tested by components/client/OP_contacts.test.js (plain node).
//
// The gate (spec section 1): OPC_isOn() = OP_isOn() AND (the firm switch
// tk_settings.org_contacts_enabled, cached in mgb_orgcontacts_cache by
// OPC_readSwitch in OP_store.js, OR the personal preview
// mgb_orgcontacts_preview = "1"). Clients decide only on mine().contacts_enabled.

// Same character class as RB_EMAIL_RE and cc__email_ok: no ? & , % # < > "
// (they would be dropped from the chips or add parameters to a mailto: link).
var OPC_EMAIL_RE = /^[^\s@?&,%#<>"]+@[^\s@?&,%#<>"]+\.[^\s@?&,%#<>"]+$/;
// Control characters ([[:cntrl:]] on the server): newlines, tabs, DEL, C1.
var OPC_CNTRL_RE = /[\u0000-\u001f\u007f-\u009f]/;

var OPC_MAX_OTHERS = 24; // 25 with the main contact (server cap)
var OPC_LIMITS = { name: 120, email: 254, title: 120, greeting: 80 };

var OPC_SOURCE_LABEL = {
  main: "Main contact",
  profile: "Main contact (from org profile, not saved as a contact yet)",
  contact: "Contact list",
  login: "Portal login",
};

function OPC__str(v) {
  return v === null || v === undefined ? "" : String(v);
}

function OPC_normalizeEmail(e) {
  return OPC__str(e).trim().toLowerCase();
}

function OPC_emailOk(e) {
  var s = OPC__str(e).trim();
  return s.length > 0 && s.length <= OPC_LIMITS.email && OPC_EMAIL_RE.test(s);
}

function OPC_sourceLabel(p) {
  var s = p && typeof p === "object" ? p.source : p;
  return OPC_SOURCE_LABEL[s] || "";
}

// The server's people order is already deduped; this mirrors cc__people's
// rule for previews and tests: by lower(trim(email)), first wins, later
// duplicates only fill a blank phone or title and opted_out true. Entries
// with no email are kept and never merged.
function OPC_dedupePeople(list) {
  var out = [];
  var at = {};
  (Array.isArray(list) ? list : []).forEach(function (p) {
    if (!p || typeof p !== "object") return;
    var key = OPC_normalizeEmail(p.email);
    if (!key) {
      out.push(Object.assign({}, p));
      return;
    }
    if (at[key] === undefined) {
      at[key] = out.length;
      out.push(Object.assign({}, p, { email: key }));
      return;
    }
    var first = out[at[key]];
    if (!OPC__str(first.phone).trim() && OPC__str(p.phone).trim()) first.phone = p.phone;
    if (!OPC__str(first.title).trim() && OPC__str(p.title).trim()) first.title = p.title;
    if (p.opted_out) first.opted_out = true;
  });
  return out;
}

// "Hi Jim," -> "Jim"; "" -> null. Same rule as the save RPC.
function OPC_cleanGreeting(v) {
  var s = OPC__str(v).trim();
  s = s.replace(/^\s*(hi|hello|dear)\b[\s,:]*/i, "");
  s = s.replace(/[\s,:]+$/, "").trim();
  return s ? s : null;
}

// A blank "other person" row for the client form.
function OPC_blankRow() {
  return { id: null, name: "", email: "", title: "", gets_monthly_emails: true, can_answer: false };
}

// mine().people (gate on) -> the form's "other people" rows (main row left
// out: it is edited through the main-contact fields).
function OPC_rowsFromMine(mine) {
  var people = (mine && Array.isArray(mine.people) ? mine.people : []).filter(function (p) {
    return p && !p.is_main;
  });
  return people.map(function (p) {
    return {
      id: p.id || null,
      name: OPC__str(p.name),
      email: OPC__str(p.email),
      title: OPC__str(p.title),
      gets_monthly_emails: !!p.gets_monthly_emails,
      can_answer: !!p.can_answer,
    };
  });
}

function OPC__rowChanged(a, b) {
  return (
    OPC__str(a.name).trim() !== OPC__str(b.name).trim() ||
    OPC_normalizeEmail(a.email) !== OPC_normalizeEmail(b.email) ||
    OPC__str(a.title).trim() !== OPC__str(b.title).trim() ||
    !!a.gets_monthly_emails !== !!b.gets_monthly_emails ||
    !!a.can_answer !== !!b.can_answer
  );
}

// Check the "other people" rows before a save.
//   rows      the form's rows ({id?, name, email, title, gets_monthly_emails, can_answer})
//   mainEmail the main contact email typed in the form
//   original  the rows as loaded (OPC_rowsFromMine); ids missing from `rows`
//             are removals
// -> { errors: {"people.N.field": message}, payload: {upsert, remove} }.
// Only new or changed rows go in upsert. Errors name the row and the field,
// never the value. A fully blank new row is skipped (not an error).
function OPC_checkPeople(rows, mainEmail, original) {
  var errors = {};
  var upsert = [];
  var remove = [];
  var seen = {};
  var main = OPC_normalizeEmail(mainEmail);
  var orig = {};
  (Array.isArray(original) ? original : []).forEach(function (o) {
    if (o && o.id) orig[o.id] = o;
  });
  var kept = {};
  var list = Array.isArray(rows) ? rows : [];
  var counted = 0;
  list.forEach(function (r, i) {
    if (!r) return;
    var n = i + 1;
    var k = "people." + i + ".";
    var name = OPC__str(r.name).trim();
    var email = OPC_normalizeEmail(r.email);
    var title = OPC__str(r.title).trim();
    if (r.id) kept[r.id] = true;
    if (!r.id && !name && !email && !title) return; // untouched blank row
    counted++;
    if (!name) errors[k + "name"] = "Person " + n + ": add a name.";
    else if (name.length > OPC_LIMITS.name) errors[k + "name"] = "Person " + n + ": the name is too long (max 120 characters).";
    else if (OPC_CNTRL_RE.test(name)) errors[k + "name"] = "Person " + n + ": the name has characters a name cannot have.";
    if (!email) errors[k + "email"] = "Person " + n + ": add an email.";
    else if (!OPC_emailOk(email)) errors[k + "email"] = "Person " + n + ": that doesn't look like an email address.";
    else if (main && email === main) errors[k + "email"] = "Person " + n + ": Already the main contact.";
    else if (seen[email]) errors[k + "email"] = "Person " + n + ": this email is already in the list.";
    if (email) seen[email] = true;
    if (title.length > OPC_LIMITS.title) errors[k + "title"] = "Person " + n + ": the role or title is too long (max 120 characters).";
    else if (OPC_CNTRL_RE.test(title)) errors[k + "title"] = "Person " + n + ": the role or title has characters a title cannot have.";
    var entry = {
      name: name,
      email: email,
      title: title || null,
      gets_monthly_emails: !!r.gets_monthly_emails,
      can_answer: !!r.can_answer,
    };
    if (r.id) {
      if (!orig[r.id] || OPC__rowChanged(entry, orig[r.id])) upsert.push(Object.assign({ id: r.id }, entry));
    } else {
      upsert.push(entry);
    }
  });
  Object.keys(orig).forEach(function (id) {
    if (!kept[id]) remove.push(id);
  });
  if (counted > OPC_MAX_OTHERS) errors.people = "You can list up to " + OPC_MAX_OTHERS + " other people.";
  if (upsert.length > 25 || remove.length > 25) errors.people = "That's too many changes at once. Save some, then the rest.";
  return { errors: errors, payload: { upsert: upsert, remove: remove } };
}

// contact_list (cc__people) -> To chips for the email draft.
// One chip per person with a valid email; logins that opted out are skipped.
// On: is_main or gets_monthly_emails, never anyone opted out. If none is on,
// the first chip that is not opted out is on. `seen` (optional) is shared
// with the caller's Cc de-duplication.
function OPC_toChips(people, seen) {
  seen = seen || {};
  var out = [];
  (Array.isArray(people) ? people : []).forEach(function (p) {
    if (!p) return;
    var email = OPC_normalizeEmail(p.email);
    if (!email || seen[email] || !OPC_EMAIL_RE.test(email)) return;
    if (p.source === "login" && p.opted_out) return;
    seen[email] = true;
    var label = OPC_sourceLabel(p);
    var tip = email + (label ? " · " + label : "") + (p.opted_out ? " · Opted out of portal emails" : "");
    out.push({
      email: email,
      name: OPC__str(p.name).trim(),
      on: !p.opted_out && !!(p.is_main || p.gets_monthly_emails),
      source: p.source || "contact",
      optedOut: !!p.opted_out,
      tip: tip,
    });
  });
  if (out.length && !out.some(function (x) { return x.on; })) {
    for (var i = 0; i < out.length; i++) {
      if (!out[i].optedOut) {
        out[i].on = true;
        break;
      }
    }
  }
  return out;
}

function OPC__ls(k) {
  try {
    return window.localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}

// Staff gate. The org-profile gate first, then the contacts switch cache or
// the personal preview.
function OPC_isOn() {
  if (typeof OP_isOn !== "function" || !OP_isOn()) return false;
  if (typeof OPC_readSwitch === "function") OPC_readSwitch();
  return OPC__ls("mgb_orgcontacts_cache") === "1" || OPC__ls("mgb_orgcontacts_preview") === "1";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    OPC_EMAIL_RE: OPC_EMAIL_RE,
    OPC_CNTRL_RE: OPC_CNTRL_RE,
    OPC_MAX_OTHERS: OPC_MAX_OTHERS,
    OPC_LIMITS: OPC_LIMITS,
    OPC_SOURCE_LABEL: OPC_SOURCE_LABEL,
    OPC_normalizeEmail: OPC_normalizeEmail,
    OPC_emailOk: OPC_emailOk,
    OPC_sourceLabel: OPC_sourceLabel,
    OPC_dedupePeople: OPC_dedupePeople,
    OPC_cleanGreeting: OPC_cleanGreeting,
    OPC_blankRow: OPC_blankRow,
    OPC_rowsFromMine: OPC_rowsFromMine,
    OPC_checkPeople: OPC_checkPeople,
    OPC_toChips: OPC_toChips,
    OPC_isOn: OPC_isOn,
  };
}
